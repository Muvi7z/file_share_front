import Hls from "hls.js";

export type PlaybackAudioTrack = { index: number; id?: string; label: string };
type NativeTracks = EventTarget & ArrayLike<{ label: string; language: string; enabled: boolean }>;

function waitForHlsAudio(player: Hls, media: HTMLVideoElement, onWaiting: (waiting: boolean) => void) {
  const autoplay = media.autoplay;
  let selectedUrl: string | undefined;
  let pendingTrack: number | null = null;
  let bufferedAudio: TimeRanges | undefined;
  let resumePlayback = false;

  const finishWaiting = () => {
    if (pendingTrack === null) return;
    pendingTrack = null;
    onWaiting(false);
    if (resumePlayback) void media.play().catch(() => { /* Autoplay can require a click. */ });
    resumePlayback = false;
  };
  const checkBuffer = () => {
    if (pendingTrack === null || !bufferedAudio) return;
    const time = media.currentTime;
    for (let i = 0; i < bufferedAudio.length; i++) {
      // The first audio sample can start slightly after the video timestamp.
      if (bufferedAudio.start(i) <= time + 0.25 && bufferedAudio.end(i) > time) {
        finishWaiting();
        return;
      }
    }
  };
  const holdPlayback = () => {
    if (pendingTrack === null) return;
    resumePlayback = true;
    media.pause();
  };

  player.on(Hls.Events.AUDIO_TRACK_SWITCHING, (_, track) => {
    if (selectedUrl === track.url) return;
    const firstTrack = selectedUrl === undefined;
    selectedUrl = track.url;
    if (!track.url) {
      media.autoplay = autoplay;
      finishWaiting();
      return;
    }
    media.autoplay = false;
    pendingTrack = track.id;
    bufferedAudio = undefined;
    resumePlayback ||= !media.paused || (firstTrack && autoplay);
    media.pause();
    onWaiting(true);
  });
  player.on(Hls.Events.BUFFER_APPENDED, (_, data) => {
    if (data.type !== "audio" || data.frag.level !== pendingTrack || data.frag.sn === "initSegment") return;
    bufferedAudio = data.timeRanges.audio;
    checkBuffer();
  });
  media.addEventListener("play", holdPlayback);
  media.addEventListener("seeked", checkBuffer);

  return {
    isWaiting: () => pendingTrack !== null,
    dispose() {
      media.removeEventListener("play", holdPlayback);
      media.removeEventListener("seeked", checkBuffer);
      media.autoplay = autoplay;
      onWaiting(false);
    }
  };
}

export function rewriteHlsMaster(manifest: string, masterUrl: URL) {
  const videoRoot = new URL("../", masterUrl);
  const resolve = (uri: string, audio: boolean) => {
    uri = uri.replace(/\\/g, "/");
    // FFmpeg writes folder-relative paths; the API exposes flat video routes
    // and a separate audio route for each track ID.
    const match = /^(?:\.\/)?([\w-]+)\/([^/?#]+)([?#].*)?$/.exec(uri);
    if (match && audio && match[1] !== "video") {
      return new URL(`audio/${match[1]}/hls/${match[2]}${match[3] ?? ""}`, videoRoot).href;
    }
    if (match && !audio && match[1] === "video") {
      return new URL(`${match[2]}${match[3] ?? ""}`, masterUrl).href;
    }
    return new URL(uri, masterUrl).href;
  };

  return manifest.split(/\r?\n/).map(line => {
    const entry = line.trim();
    if (entry.startsWith("#")) {
      const audio = entry.startsWith("#EXT-X-MEDIA:") && /[:,]TYPE=AUDIO(?:,|$)/.test(entry);
      return entry.replace(/\bURI="([^"]+)"/g, (_, uri: string) => `URI="${resolve(uri, audio)}"`);
    }
    return entry ? resolve(entry, false) : "";
  }).join("\n");
}

export function attachHls(
  media: HTMLVideoElement,
  masterUrl: string,
  onTracks: (tracks: PlaybackAudioTrack[], selected: number) => void,
  onError: (message: string, waitingForAudio?: boolean) => void,
  onAudioWaiting: (waiting: boolean) => void
) {
  const controller = new AbortController();
  const nativeTracks = (media as HTMLVideoElement & { audioTracks?: NativeTracks }).audioTracks;
  let hls: Hls | undefined;
  let audioGate: ReturnType<typeof waitForHlsAudio> | undefined;
  let sourceUrl: string | undefined;

  const syncNativeTracks = () => {
    const tracks = Array.from(nativeTracks ?? []);
    onTracks(tracks.map((track, index) => ({
      index,
      label: track.label || track.language || `Дорожка ${index + 1}`
    })), tracks.findIndex(track => track.enabled));
  };

  const start = async () => {
    const response = await fetch(masterUrl, { signal: controller.signal, credentials: "include" });
    if (!response.ok) throw new Error(`Не удалось открыть HLS-плейлист (HTTP ${response.status}).`);
    const manifest = await response.text();
    if (!manifest.trimStart().startsWith("#EXTM3U")) throw new Error("Сервер вернул некорректный HLS-плейлист.");
    if (controller.signal.aborted) return;
    const rewritten = rewriteHlsMaster(manifest, new URL(response.url || masterUrl, location.href));
    sourceUrl = URL.createObjectURL(new Blob([rewritten], { type: "application/vnd.apple.mpegurl" }));

    if (Hls.isSupported()) {
      const player = hls = new Hls({
        xhrSetup(xhr) {
          xhr.withCredentials = true;
        }
      });
      audioGate = waitForHlsAudio(player, media, onAudioWaiting);
      const syncTracks = () => onTracks(player.audioTracks.map((track, index) => ({
        index,
        id: /\/audio\/([^/]+)\/hls\//.exec(track.url)?.[1],
        label: track.name || track.lang || `Дорожка ${index + 1}`
      })), player.audioTrack);
      player.on(Hls.Events.AUDIO_TRACKS_UPDATED, syncTracks);
      player.on(Hls.Events.AUDIO_TRACK_SWITCHING, syncTracks);
      player.on(Hls.Events.AUDIO_TRACK_SWITCHED, syncTracks);
      player.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        const status = data.response?.code;
        const message = status ? `Ошибка загрузки HLS (HTTP ${status}).` : `Не удалось воспроизвести HLS (${data.details}).`;
        onError(message, audioGate?.isWaiting());
      });
      player.loadSource(sourceUrl);
      player.attachMedia(media);
    } else if (media.canPlayType("application/vnd.apple.mpegurl")) {
      for (const event of ["addtrack", "removetrack", "change"]) nativeTracks?.addEventListener(event, syncNativeTracks);
      media.addEventListener("loadedmetadata", syncNativeTracks);
      media.src = sourceUrl;
    } else {
      throw new Error("Этот браузер не поддерживает воспроизведение HLS.");
    }
  };

  void start().catch(error => {
    if (!controller.signal.aborted) onError(error instanceof Error ? error.message : "Не удалось загрузить HLS.");
  });

  return {
    selectAudio(index: number) {
      if (hls) hls.audioTrack = index;
      else if (nativeTracks?.[index]) {
        nativeTracks[index].enabled = true;
        for (let i = 0; i < nativeTracks.length; i++) {
          if (i !== index) nativeTracks[i].enabled = false;
        }
        syncNativeTracks();
      }
    },
    destroy() {
      controller.abort();
      hls?.destroy();
      audioGate?.dispose();
      media.removeEventListener("loadedmetadata", syncNativeTracks);
      for (const event of ["addtrack", "removetrack", "change"]) nativeTracks?.removeEventListener(event, syncNativeTracks);
      if (sourceUrl) {
        if (media.getAttribute("src") === sourceUrl) {
          media.removeAttribute("src");
          media.load();
        }
        URL.revokeObjectURL(sourceUrl);
      }
    }
  };
}

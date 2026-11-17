import { createFile, type MP4BoxBuffer } from "mp4box";

// Repackage indexed MP4 samples in memory for MSE. The server and source file
// remain unchanged; only bounded byte ranges are requested from the existing API.
export function progressiveMp4(video: HTMLVideoElement, url: string, onError: (message: string) => void) {
  const Source = window.MediaSource || (window as Window & { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource!;
  const previousRemotePlayback = video.disableRemotePlayback;
  if (!window.MediaSource) video.disableRemotePlayback = true;
  const source = new Source();
  const objectUrl = URL.createObjectURL(source);
  const file = createFile();
  const buffers = new Map<number, { buffer: SourceBuffer; queue: ArrayBuffer[] }>();
  let disposed = false;
  let ready = false;
  let busy = false;
  let offset = 0;
  let total = Infinity;
  let ended = false;
  let generation = 0;
  let request: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fallback = false;

  const fail = (error: unknown) => {
    if (disposed) return;
    stop();
    onError(error instanceof Error ? error.message : "Не удалось загрузить видео частями.");
  };
  const stop = () => {
    disposed = true;
    request?.abort();
    clearTimeout(timer);
    file.stop();
  };
  const nativeFallback = () => {
    fallback = true;
    stop();
    video.src = url;
    video.load();
    void video.play().catch(() => undefined);
  };
  const drain = () => {
    if (disposed || source.readyState === "closed") return;
    try {
      for (const { buffer, queue } of buffers.values()) {
        if (buffer.updating) continue;
        const cutoff = video.currentTime - 30;
        const end = buffer.buffered.length ? buffer.buffered.end(buffer.buffered.length - 1) : 0;
        if (cutoff > 0 && buffer.buffered.length && buffer.buffered.start(0) < cutoff - 5) {
          buffer.remove(0, cutoff);
        } else if (end > video.currentTime + 90) {
          buffer.remove(video.currentTime + 60, end);
        } else if (queue.length) {
          buffer.appendBuffer(queue.shift()!);
        }
      }
      if (ended && source.readyState === "open" && [...buffers.values()].every(({ buffer, queue }) => !buffer.updating && !queue.length)) {
        source.endOfStream();
      }
    } catch (error) { fail(error); }
  };
  file.onError = (_module, message) => fail(new Error(message));
  file.onSegment = (id, _user, data, nextSample) => {
    if (disposed) return;
    buffers.get(id)?.queue.push(data);
    file.releaseUsedSamples(id, nextSample);
    drain();
  };
  file.onReady = info => {
    try {
      const tracks = [info.videoTracks[0], info.audioTracks[0]].filter(Boolean);
      if (info.isFragmented || !tracks.length || tracks.some(track =>
        !Source.isTypeSupported(`${track.video ? "video" : "audio"}/mp4; codecs="${track.codec}"`))) {
        nativeFallback();
        return;
      }
      source.duration = info.duration / info.timescale;
      for (const track of tracks) {
        const buffer = source.addSourceBuffer(`${track.video ? "video" : "audio"}/mp4; codecs="${track.codec}"`);
        buffers.set(track.id, { buffer, queue: [] });
        buffer.addEventListener("updateend", drain);
        buffer.addEventListener("error", () => fail(new Error("Браузер не смог обработать поток видео.")));
        file.setSegmentOptions(track.id, null, { nbSamples: 60 });
      }
      for (const segment of file.initializeSegmentation("per-track")) buffers.get(segment.id)!.queue.push(segment.buffer);
      ready = true;
      file.start();
      drain();
    } catch (error) { fail(error); }
  };
  const bufferedAhead = () => {
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime + 0.1 && video.buffered.end(i) > video.currentTime)
        return video.buffered.end(i) - video.currentTime;
    }
    return 0;
  };
  const pump = async () => {
    if (disposed || busy || ended) return;
    if (bufferedAhead() > 30 || [...buffers.values()].some(({ queue }) => queue.length > 40)) {
      timer = setTimeout(() => void pump(), 250);
      return;
    }
    busy = true;
    const revision = generation;
    request = new AbortController();
    const timeout = setTimeout(() => request?.abort(), 30000);
    try {
      const start = offset;
      const response = await fetch(url, {
        headers: { Range: `bytes=${start}-${Math.min(start + 1024 * 1024 - 1, total - 1)}` },
        signal: request.signal
      });
      const range = response.headers.get("Content-Range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (response.status !== 206 || !range || Number(range[1]) !== start) {
        await response.body?.cancel();
        nativeFallback();
        return;
      }
      total = Number(range[3]);
      const data = await response.arrayBuffer() as MP4BoxBuffer;
      if (disposed || revision !== generation) return;
      if (!data.byteLength || data.byteLength !== Number(range[2]) - start + 1) throw new Error("Передача видео прервалась. Попробуйте снова.");
      data.fileStart = start;
      const wasReady = ready;
      offset = file.appendBuffer(data) ?? start + data.byteLength;
      // After a seek the box parser can still point at an earlier mdat header.
      // Samples are already indexed; do not re-download those old box headers.
      if (wasReady) offset = Math.max(offset, start + data.byteLength);
      if (offset >= total) {
        file.flush();
        ended = true;
        drain();
      }
    } catch (error) {
      if (!disposed && revision === generation) fail(error);
    } finally {
      clearTimeout(timeout);
      busy = false;
      if (!disposed && !ended) timer = setTimeout(() => void pump(), 0);
    }
  };
  const seek = () => {
    if (!ready || disposed || bufferedAhead() > 0.5) return;
    generation++;
    request?.abort();
    clearTimeout(timer);
    ended = false;
    file.stop();
    for (const [id, state] of buffers) {
      state.queue.length = 0;
      file.releaseUsedSamples(id, 0);
    }
    offset = file.seek(video.currentTime, true).offset;
    file.start();
    void pump();
  };
  source.addEventListener("sourceopen", () => { if (!ready) void pump(); }, { once: true });
  video.addEventListener("seeking", seek);
  video.src = objectUrl;
  return () => {
    stop();
    video.removeEventListener("seeking", seek);
    for (const { buffer } of buffers.values()) buffer.removeEventListener("updateend", drain);
    if (!fallback && video.getAttribute("src") === objectUrl) {
      video.removeAttribute("src");
      video.load();
    }
    URL.revokeObjectURL(objectUrl);
    video.disableRemotePlayback = previousRemotePlayback;
  };
}

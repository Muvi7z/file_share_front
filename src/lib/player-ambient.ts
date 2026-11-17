export function startPlayerAmbient(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const page = document;
  const frame = page.createElement("canvas");
  const frameContext = frame.getContext("2d", { alpha: false });
  const context = canvas.getContext("2d");
  if (!frameContext || !context) return () => {};
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const supportsFilter = typeof (context as Partial<CanvasRenderingContext2D>).filter === "string";
  const baseInterval = navigator.hardwareConcurrency > 4 ? 250 : 500;
  let interval = baseInterval;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frameId: number | undefined;
  let visible = false;
  let disposed = false;
  let lastTime = -1;
  let quality = video.getVideoPlaybackQuality?.();
  delete canvas.dataset.ready;

  const paint = () => {
    if (disposed || !visible || page.hidden || video.readyState < 2 || video.currentTime === lastTime) return;
    const started = performance.now();
    const aspect = video.videoWidth / video.videoHeight || 16 / 9;
    const width = Math.max(8, Math.round(64 * Math.min(1, aspect)));
    const height = Math.max(8, Math.round(64 / Math.max(1, aspect)));
    if (frame.width !== width || frame.height !== height) {
      frame.width = width;
      frame.height = height;
      canvas.width = Math.ceil(width * 1.5);
      canvas.height = Math.ceil(height * 1.5);
    }
    const x = (canvas.width - width) / 2;
    const y = (canvas.height - height) / 2;
    try {
      frameContext.drawImage(video, 0, 0, width, height);
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (supportsFilter) {
        context.filter = "blur(5px) saturate(1.2) brightness(1.35)";
        context.drawImage(frame, x, y);
      } else {
        context.globalAlpha = 1 / 9;
        for (const dx of [-4, 0, 4]) for (const dy of [-4, 0, 4]) context.drawImage(frame, x + dx, y + dy);
        context.globalAlpha = 1;
      }
      canvas.dataset.ready = "true";
      lastTime = video.currentTime;
      const nextQuality = video.getVideoPlaybackQuality?.();
      const total = (nextQuality?.totalVideoFrames ?? 0) - (quality?.totalVideoFrames ?? 0);
      const dropped = (nextQuality?.droppedVideoFrames ?? 0) - (quality?.droppedVideoFrames ?? 0);
      if (performance.now() - started > 8 || (total > 0 && dropped / total > .05)) interval = Math.min(1000, interval * 2);
      else interval = Math.max(baseInterval, interval - 50);
      quality = nextQuality;
    } catch { /* Retry once a decoded frame is available. */ }
  };
  const schedule = () => {
    if (disposed || !visible || page.hidden || video.paused || video.ended || motion.matches) return;
    // Request only one decoded frame per interval, not a callback for every video frame.
    timer = setTimeout(() => {
      timer = undefined;
      if (typeof video.requestVideoFrameCallback === "function") {
        frameId = video.requestVideoFrameCallback(() => { frameId = undefined; paint(); schedule(); });
      } else { paint(); schedule(); }
    }, interval);
  };
  const stop = () => {
    clearTimeout(timer);
    if (frameId !== undefined) video.cancelVideoFrameCallback(frameId);
    frameId = undefined;
  };
  const sync = () => { if (!disposed) { stop(); paint(); schedule(); } };
  const observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    sync();
  });
  observer.observe(video);
  const events = ["playing", "pause", "seeked", "loadeddata", "ended"];
  events.forEach(event => video.addEventListener(event, sync));
  page.addEventListener("visibilitychange", sync);
  motion.addEventListener("change", sync);
  return () => {
    disposed = true;
    stop();
    observer.disconnect();
    events.forEach(event => video.removeEventListener(event, sync));
    page.removeEventListener("visibilitychange", sync);
    motion.removeEventListener("change", sync);
  };
}

export function startPlayerAmbient(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const page = document;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return () => {};
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
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
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    try {
      context.drawImage(video, 0, 0, width, height);
      // Blend with a vertical reflection so both edges receive the same light.
      context.save();
      try {
        context.translate(0, height);
        context.scale(1, -1);
        context.globalAlpha = 0.5;
        context.drawImage(video, 0, 0, width, height);
      } finally {
        context.restore();
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

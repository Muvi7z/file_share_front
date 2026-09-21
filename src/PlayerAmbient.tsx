import { useEffect, useRef, type RefObject } from "react";

export function PlayerAmbient({ mediaRef, source }: { mediaRef: RefObject<HTMLVideoElement | null>; source: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const video = mediaRef.current;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d", { alpha: false });
    if (!video || !ctx || !canvas) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const paint = () => {
      if (document.hidden || video.readyState < 2) return;
      try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch { /* Retry when a decoded frame is available. */ }
    };
    const tick = () => {
      paint();
      if (!document.hidden && !video.paused && !video.ended && !motion.matches) timer = setTimeout(tick, 125);
    };
    const sync = () => { clearTimeout(timer); tick(); };
    const events = ["playing", "pause", "seeked", "loadeddata", "ended"];
    events.forEach(event => video.addEventListener(event, sync));
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    sync();
    return () => {
      clearTimeout(timer);
      events.forEach(event => video.removeEventListener(event, sync));
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
    };
  }, [mediaRef, source]);
  return <canvas ref={ref} className="player-ambient" width={64} height={36} aria-hidden="true" />;
}

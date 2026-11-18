import { useEffect, useRef, type RefObject } from "react";
import { startPlayerAmbient } from "./lib/player-ambient";

const ambientSpread = 128;

export function PlayerAmbient({ mediaRef, source }: { mediaRef: RefObject<HTMLVideoElement | null>; source: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const video = mediaRef.current;
    const layer = layerRef.current;
    const content = video?.closest(".content.player-page");
    if (!video || !layer || !content) return;

    let updateFrame = 0;
    const updateBounds = () => {
      updateFrame = 0;
      const frame = video.getBoundingClientRect();
      const viewport = content.getBoundingClientRect();
      const contentLeft = viewport.left + content.clientLeft;
      const left = Math.max(0, contentLeft);
      const right = Math.min(document.documentElement.clientWidth, contentLeft + content.clientWidth);
      const top = Math.max(0, viewport.top + content.clientTop);
      const bottom = Math.min(window.innerHeight, viewport.top + content.clientTop + content.clientHeight);

      // Keep the full glow where it fits and fade it before the scrollport clips it.
      layer.style.setProperty("--ambient-top", `${Math.min(ambientSpread, frame.top - top)}px`);
      layer.style.setProperty("--ambient-right", `${Math.min(ambientSpread, right - frame.right)}px`);
      layer.style.setProperty("--ambient-bottom", `${Math.min(ambientSpread, bottom - frame.bottom)}px`);
      layer.style.setProperty("--ambient-left", `${Math.min(ambientSpread, frame.left - left)}px`);
    };
    const scheduleBounds = () => {
      if (!updateFrame) updateFrame = requestAnimationFrame(updateBounds);
    };

    updateBounds();
    const observer = new ResizeObserver(scheduleBounds);
    observer.observe(video);
    observer.observe(content);
    const topbar = content.querySelector(".player-topbar");
    if (topbar) observer.observe(topbar);
    window.addEventListener("scroll", scheduleBounds, { capture: true, passive: true });
    window.addEventListener("resize", scheduleBounds);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(updateFrame);
      window.removeEventListener("scroll", scheduleBounds, true);
      window.removeEventListener("resize", scheduleBounds);
    };
  }, [mediaRef]);

  useEffect(() => {
    const video = mediaRef.current;
    const canvas = ref.current;
    if (!video || !canvas) return;
    return startPlayerAmbient(video, canvas);
  }, [mediaRef, source]);
  return <div ref={layerRef} className="player-ambient" aria-hidden="true">
    <canvas ref={ref} width={64} height={36} />
  </div>;
}

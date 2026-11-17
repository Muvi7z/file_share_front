import { useEffect, useRef, type RefObject } from "react";
import { startPlayerAmbient } from "./lib/player-ambient";

export function PlayerAmbient({ mediaRef, source }: { mediaRef: RefObject<HTMLVideoElement | null>; source: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const video = mediaRef.current;
    const canvas = ref.current;
    if (!video || !canvas) return;
    return startPlayerAmbient(video, canvas);
  }, [mediaRef, source]);
  return <canvas ref={ref} className="player-ambient" width={96} height={54} aria-hidden="true" />;
}

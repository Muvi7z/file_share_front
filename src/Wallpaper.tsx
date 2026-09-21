import { SlimeWallpaper } from "./SlimeWallpaper";
import { useEffect, useRef, useState } from "react";

export type WallpaperVariant = "hunt" | "dark" | "water" | "rostislav" | "good-bad" | "slime";

const wallpaperVideos: Record<Exclude<WallpaperVariant, "dark" | "good-bad" | "slime">, string> = {
  rostislav: "/media/rostislav-uzunov-7670836.mp4",
  hunt: "/media/hunt-showdown.mp4",
  water: "/media/black-water-illusion.mp4"
};

export function Wallpaper({ variant }: { variant: WallpaperVariant }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (document.hidden || motion.matches) video.pause();
      else void video.play().catch(() => { /* Static first frame if autoplay is unavailable. */ });
    };
    sync();
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      video.pause();
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [variant]);
  return <div className={`liquid-scene wallpaper-${variant}`} aria-hidden="true">
    {variant === "slime" && <SlimeWallpaper />}
    {variant === "good-bad" && <SceneWallpaper key={variant} source="/media/good-bad-fake" />}
    {variant !== "dark" && variant !== "good-bad" && variant !== "slime" && <video key={variant} ref={ref} className="water-wallpaper" src={wallpaperVideos[variant]} muted loop playsInline preload="auto" tabIndex={-1} />}
    <div className="water-shade" />
  </div>;
}

function SceneWallpaper({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    // A separate target keeps an obsolete asynchronous mount out of the active scene.
    const target = document.createElement("div");
    target.className = "scene-canvas";
    container.appendChild(target);
    let disposed = false;
    let instance: import("webwallgl").SceneInstance | undefined;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (document.hidden || motion.matches) instance?.pause();
      else instance?.resume();
    };
    void import("webwallgl").then(async ({ mount, httpSource }) => {
      if (disposed) return;
      const scene = await mount(target, {
        source: httpSource(source),
        fps: 30, renderDpr: 1, fit: "cover", volume: 0, audio: null, media: null,
        autoplay: !document.hidden && !motion.matches
      });
      if (disposed) { scene.destroy({ releasePkgCache: true }); return; }
      instance = scene;
      setStatus("ready");
      sync();
    }).catch((error: unknown) => {
      if (!disposed) { setStatus("error"); console.error("Wallpaper scene failed", error); }
    });
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
      instance?.destroy({ releasePkgCache: true });
      target.remove();
    };
  }, [source]);
  return <div className="scene-wallpaper" data-status={status}>
    <div ref={host} className="scene-host" />
    {status !== "ready" && <span className="scene-status">{status === "error" ? "Не удалось открыть фон. Выберите другой в настройках." : "Загрузка живого фона…"}</span>}
  </div>;
}

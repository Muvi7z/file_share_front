import { createContext, useContext, useRef, useState } from "react";
import { ImagePlus, LoaderCircle } from "lucide-react";
import { updateVideoPoster } from "./api";
import type { VideoFile } from "./types";

export const PosterContext = createContext<((video: VideoFile) => void) | null>(null);
export function PosterControl({ video }: { video: VideoFile }) {
  const onUpdated = useContext(PosterContext);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!onUpdated) return null;
  return <div className="inline-poster-control">
    <input hidden ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
      setError("");
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) { setError("Выберите JPEG, PNG или WebP до 10 МБ"); return; }
      setBusy(true);
      try { onUpdated(await updateVideoPoster(video.id, file)); } catch (err) { setError(err instanceof Error ? err.message : "Не удалось сменить постер"); } finally { setBusy(false); }
    }} />
    <button className="icon-button" title="Сменить постер" aria-label={`Сменить постер ${video.title}`} disabled={busy} onClick={() => input.current?.click()}>{busy ? <LoaderCircle className="spin" size={18} /> : <ImagePlus size={18} />}</button>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

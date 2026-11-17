import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ListVideo, Play } from "lucide-react";
import { Button } from "./components/ui/button";
import { Switch } from "./components/ui/switch";
import type { VideoFile } from "./types";

export function PlayerPlaylist({ playlist, currentIndex, autoplay, onAutoplayChange, onSelect, renderPoster }: {
  playlist: VideoFile[];
  currentIndex: number;
  autoplay: boolean;
  onAutoplayChange: (value: boolean) => void;
  onSelect: (video: VideoFile) => void;
  renderPoster: (video: VideoFile) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const pendingFocus = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 420, rowHeight: 82 });
  const rowHeight = viewport.rowHeight;
  const start = Math.max(0, Math.floor(viewport.top / rowHeight) - 4);
  const end = Math.min(playlist.length, Math.ceil((viewport.top + viewport.height) / rowHeight) + 4);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const rowHeight = parseFloat(getComputedStyle(list).getPropertyValue("--playlist-row-height")) || 82;
      if (!userScrolled.current) {
        list.scrollTop = Math.max(0, currentIndex * rowHeight - (list.clientHeight - rowHeight) / 2);
      }
      setViewport({ top: list.scrollTop, height: list.clientHeight, rowHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [currentIndex, playlist.length]);

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    listRef.current?.querySelector<HTMLButtonElement>(`[data-index="${pendingFocus.current}"]`)?.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [viewport]);

  return <aside className="watch-playlist" aria-label="Плейлист">
    <header className="watch-playlist-header"><div><ListVideo size={18} /><h2>Плейлист</h2></div><span>{currentIndex + 1} / {playlist.length}</span></header>
    <label className="playlist-autoplay"><span>Автопереход</span><Switch checked={autoplay} onCheckedChange={onAutoplayChange} aria-label="Автоматически включать следующее видео" /></label>
    <div className="playlist-items" ref={listRef} role="list" aria-label="Видео в очереди"
      onWheel={() => { userScrolled.current = true; }}
      onTouchStart={() => { userScrolled.current = true; }}
      onPointerDown={() => { userScrolled.current = true; }}
      onScroll={event => { const { scrollTop, clientHeight } = event.currentTarget; setViewport(current => ({ ...current, top: scrollTop, height: clientHeight })); }}
      onKeyDown={event => {
        userScrolled.current = true;
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
        if (!row || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = Number(row.dataset.index);
        const next = Math.max(0, Math.min(playlist.length - 1, event.key === "Home" ? 0 : event.key === "End" ? playlist.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1)));
        const list = event.currentTarget;
        pendingFocus.current = next;
        if (next * rowHeight < list.scrollTop) list.scrollTop = next * rowHeight;
        else if ((next + 1) * rowHeight > list.scrollTop + list.clientHeight) list.scrollTop = (next + 1) * rowHeight - list.clientHeight;
        setViewport(current => ({ ...current, top: list.scrollTop, height: list.clientHeight }));
      }}>
      <div className="playlist-window" style={{ height: playlist.length * rowHeight }}>
        {playlist.slice(start, end).map((item, offset) => {
          const index = start + offset;
          const current = index === currentIndex;
          return <div key={item.id} role="listitem" aria-posinset={index + 1} aria-setsize={playlist.length} className="playlist-row" style={{ top: index * rowHeight }}>
            <Button variant="ghost" data-index={index} className={`playlist-item ${current ? "current" : ""}`}
              aria-current={current ? "true" : undefined} aria-label={`${current ? "Сейчас играет: " : "Воспроизвести: "}${item.title}`}
              onClick={() => { if (!current) onSelect(item); }}>
              <span className="playlist-position">{current ? <Play size={14} fill="currentColor" /> : index + 1}</span>
              <span className="playlist-poster">{renderPoster(item)}</span>
              <span className="playlist-copy"><strong>{item.title}</strong><small>{current ? "Сейчас играет" : item.folderName}</small></span>
            </Button>
          </div>;
        })}
      </div>
    </div>
  </aside>;
}

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ListVideo, Play } from "lucide-react";
import { Button } from "./components/ui/button";
import { Switch } from "./components/ui/switch";
import type { VideoFile } from "./types";

export function PlayerPlaylist({ playlist, currentIndex, autoplay, onAutoplayChange, collapsed, onCollapsedChange, onSelect, renderPoster }: {
  playlist: VideoFile[];
  currentIndex: number;
  autoplay: boolean;
  onAutoplayChange: (value: boolean) => void;
  collapsed: boolean;
  onCollapsedChange: (value: boolean) => void;
  onSelect: (video: VideoFile) => void;
  renderPoster: (video: VideoFile) => ReactNode;
}) {
  const panelId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const userScrolled = useRef(false);
  const pendingFocus = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 420, rowHeight: 82 });
  const rowHeight = viewport.rowHeight;
  const start = Math.max(0, Math.floor(viewport.top / rowHeight) - 4);
  const end = Math.min(playlist.length, Math.ceil((viewport.top + viewport.height) / rowHeight) + 4);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || collapsed) return;
    const measure = () => {
      const rowHeight = parseFloat(getComputedStyle(list).getPropertyValue("--playlist-row-height")) || 82;
      list.scrollTop = userScrolled.current
        ? scrollTopRef.current
        : Math.max(0, currentIndex * rowHeight - (list.clientHeight - rowHeight) / 2);
      setViewport({ top: list.scrollTop, height: list.clientHeight, rowHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [collapsed, currentIndex, playlist.length]);

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    listRef.current?.querySelector<HTMLButtonElement>(`[data-index="${pendingFocus.current}"]`)?.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [viewport]);

  const toggleLabel = collapsed ? "Развернуть плейлист" : "Свернуть плейлист";

  return <aside className={`watch-playlist${collapsed ? " is-collapsed" : ""}`} aria-label="Плейлист">
    <header className="watch-playlist-header">
      <div><ListVideo size={18} aria-hidden="true" /><h2>Плейлист</h2></div>
      <Button type="button" variant="ghost" size="sm" className="playlist-collapse-button" aria-controls={panelId}
        aria-expanded={!collapsed} aria-label={`${toggleLabel}, ${currentIndex + 1} из ${playlist.length}`}
        title={toggleLabel} onClick={() => onCollapsedChange(!collapsed)}>
        <span aria-hidden="true">{currentIndex + 1} / {playlist.length}</span>
        <ChevronDown aria-hidden="true" />
      </Button>
    </header>
    <div className="playlist-panel" id={panelId} hidden={collapsed}>
      <label className="playlist-autoplay"><span>Автопереход</span><Switch checked={autoplay} onCheckedChange={onAutoplayChange} aria-label="Автоматически включать следующее видео" /></label>
      <div className="playlist-items" ref={listRef} role="list" aria-label="Видео в очереди"
        onWheel={() => { userScrolled.current = true; }}
        onTouchStart={() => { userScrolled.current = true; }}
        onPointerDown={() => { userScrolled.current = true; }}
        onScroll={event => {
          if (collapsed) return;
          const { scrollTop, clientHeight } = event.currentTarget;
          scrollTopRef.current = scrollTop;
          setViewport(current => ({ ...current, top: scrollTop, height: clientHeight }));
        }}
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
    </div>
  </aside>;
}

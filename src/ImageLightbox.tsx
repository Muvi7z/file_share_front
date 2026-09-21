import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Maximize, Minus, Plus, X } from "lucide-react";

export function ImageLightbox({ src, name, description, onClose }: { src: string; name: string; description: string; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [glass, setGlass] = useState(() => document.querySelector(".app-shell")?.classList.contains("theme-glass"));
  const reset = () => setView({ scale: 1, x: 0, y: 0 });
  const zoom = (factor: number, x = 0, y = 0) => setView(old => {
    const scale = Math.max(1, Math.min(8, old.scale * factor));
    if (scale === 1) return { scale, x: 0, y: 0 };
    const ratio = scale / old.scale;
    return { scale, x: x - (x - old.x) * ratio, y: y - (y - old.y) * ratio };
  });
  useEffect(() => {
    const shell = document.querySelector(".app-shell");
    const observer = new MutationObserver(() => setGlass(shell?.classList.contains("theme-glass")));
    if (shell) observer.observe(shell, { attributes: true, attributeFilter: ["class"] });
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { observer.disconnect(); previousFocus?.focus(); };
  }, []);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      zoom(Math.exp(-Math.max(-150, Math.min(150, delta)) * .002), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    const resize = () => reset();
    window.addEventListener("resize", resize);
    return () => { element.removeEventListener("wheel", wheel); window.removeEventListener("resize", resize); };
  }, []);
  return createPortal(<div className={`modal-backdrop image-viewer-backdrop ${glass ? "theme-glass" : "theme-classic"}`} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="image-viewer" role="dialog" aria-modal="true" aria-label={`Просмотр ${name}`} tabIndex={-1} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.25); }
      if (event.key === "-") { event.preventDefault(); zoom(.8); }
      if (event.key === "0") reset();
      if (event.key === "Tab") {
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]') ?? []);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="image-viewer-header"><div><strong>{name}</strong><span>{description}</span></div>
        <div className="image-viewer-actions"><a className="icon-button" href={src} download={name} aria-label="Скачать изображение"><Download size={18} /></a><button className="icon-button" onClick={onClose} aria-label="Закрыть просмотр"><X size={20} /></button></div>
      </header>
      <div ref={stage} className={`image-viewer-stage ${view.scale > 1 ? "is-zoomed" : ""}`}
        onDoubleClick={() => view.scale > 1 ? reset() : zoom(2)}
        onPointerDown={event => { if (view.scale <= 1 || event.button !== 0) return; drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (!drag.current) return; const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y; drag.current = { x: event.clientX, y: event.clientY }; setView(old => ({ ...old, x: old.x + dx, y: old.y + dy })); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        <img src={src} alt={name} draggable={false} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
      </div>
      <footer className="image-viewer-zoom"><button onClick={() => zoom(.8)} disabled={view.scale === 1} aria-label="Уменьшить"><Minus size={18} /></button><span>{Math.round(view.scale * 100)}%</span><button onClick={() => zoom(1.25)} disabled={view.scale === 8} aria-label="Увеличить"><Plus size={18} /></button><button onClick={reset} aria-label="Вписать в окно" title="Вписать в окно (0)"><Maximize size={18} /></button><small>Колёсико — масштаб · перетаскивание — перемещение</small></footer>
    </section>
  </div>, document.body);
}

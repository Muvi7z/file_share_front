import { useEffect, useId, useRef } from "react";

// Browser adaptation of the particle-based Slime wallpaper.
export function SlimeWallpaper() {
  const svgRef = useRef<SVGSVGElement>(null);
  const filterId = useId().replace(/:/g, "");
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const circles = Array.from(svg.querySelectorAll<SVGCircleElement>(".slime-body circle"));
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let width = innerWidth, height = innerHeight;
    let targetX = width * .65, targetY = height * .45;
    let lastInput = 0, previous = 0, elapsed = 0, frame = 0;
    const nodes = circles.map(() => ({ x: targetX, y: targetY }));
    const resize = () => {
      width = innerWidth; height = innerHeight;
      targetX = Math.min(width, targetX); targetY = Math.min(height, targetY);
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    };
    const pointer = (event: PointerEvent) => {
      targetX = event.clientX; targetY = event.clientY;
      lastInput = performance.now();
    };
    const draw = (now: number) => {
      const dt = Math.min((now - (previous || now)) / 1000, .05);
      previous = now; elapsed += dt;
      const reduced = motion.matches;
      const idle = now - lastInput > 1800;
      const scale = Math.max(.55, Math.min(width, height) / 850);
      const x = targetX + (!reduced && idle ? Math.cos(elapsed * .75) * 28 * scale : 0);
      const y = targetY + (!reduced && idle ? Math.sin(elapsed * .9) * 32 * scale : 0);
      nodes.forEach((node, i) => {
        const leader = i === 0 ? { x, y } : nodes[i - 1];
        const follow = 1 - Math.exp(-dt * (i === 0 ? 5 : 9));
        node.x += (leader.x - node.x) * follow;
        node.y += (leader.y - node.y) * follow;
        const wobble = reduced ? 0 : Math.sin(elapsed * 2.1 + i * 1.7);
        const angle = i * 2.4 + elapsed * .25;
        const spread = i === 0 ? 0 : (13 + i * 3) * scale;
        circles[i].setAttribute("cx", String(node.x + Math.cos(angle) * spread));
        circles[i].setAttribute("cy", String(node.y + Math.sin(angle) * spread));
        circles[i].setAttribute("r", String((78 - i * 5 + wobble * 7) * scale));
      });
      if (!document.hidden && !reduced) frame = requestAnimationFrame(draw);
    };
    const sync = () => {
      cancelAnimationFrame(frame); previous = 0;
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    resize(); sync();
    window.addEventListener("pointermove", pointer, { passive: true });
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", pointer);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
    };
  }, []);
  return <svg ref={svgRef} className="slime-wallpaper" aria-hidden="true">
    <defs>
      <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur" />
        <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" result="body" />
        <feGaussianBlur in="body" stdDeviation="13" result="glow" />
        <feMerge><feMergeNode in="glow" /><feMergeNode in="body" /></feMerge>
      </filter>
    </defs>
    <g className="slime-body" filter={`url(#${filterId})`} fill="currentColor">
      {Array.from({ length: 9 }, (_, i) => <circle key={i} />)}
    </g>
  </svg>;
}

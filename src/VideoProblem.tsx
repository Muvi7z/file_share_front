import { useEffect, useState } from "react";
import { Flag } from "lucide-react";

type Problem = { reason: string; comment: string; time: number; createdAt: string };
const eventName = "vault-video-problem";
const key = (id: string) => `vault-video-problem:${id}`;
function read(id: string): Problem | null {
  try { return JSON.parse(localStorage.getItem(key(id)) || "null"); } catch { return null; }
}
function useProblem(id: string) {
  const [problem, setProblem] = useState(() => read(id));
  useEffect(() => {
    const sync = () => setProblem(read(id));
    sync();
    window.addEventListener(eventName, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(eventName, sync); window.removeEventListener("storage", sync); };
  }, [id]);
  return problem;
}
export function VideoProblemBadge({ id }: { id: string }) {
  const problem = useProblem(id);
  return problem ? <span className="video-problem-badge" title={`Локальная отметка: ${problem.reason}`}><Flag size={13} />Есть проблема</span> : null;
}
export function VideoProblemControl({ id, getTime }: { id: string; getTime: () => number }) {
  const problem = useProblem(id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("Зависает или повторяет кадры");
  const [comment, setComment] = useState("");
  const [time, setTime] = useState(0);
  const [error, setError] = useState("");
  function save(remove = false) {
    try {
      if (remove) localStorage.removeItem(key(id));
      else localStorage.setItem(key(id), JSON.stringify({ reason, comment: comment.trim(), time, createdAt: new Date().toISOString() }));
      window.dispatchEvent(new Event(eventName)); setOpen(false); setError("");
    } catch { setError("Браузер не разрешил сохранить отметку."); }
  }
  return <section className="video-problem-control">
    <button className="icon-text" onClick={() => {
      setReason(problem?.reason ?? "Зависает или повторяет кадры"); setComment(problem?.comment ?? "");
      setTime(problem?.time ?? Math.floor(getTime())); setOpen(value => !value);
    }} aria-expanded={open}><Flag size={17} />{problem ? "Отметка о проблеме" : "Пометить проблему"}</button>
    {problem && !open && <small role="status">Сохранено в этом браузере · {problem.reason}</small>}
    {open && <form className="video-problem-form" onSubmit={event => { event.preventDefault(); save(); }}>
      <h2>Проблема с видео</h2>
      <p>Отметка сохраняется только в этом браузере. Отправка администратору пока не подключена.</p>
      <label>Причина<select value={reason} onChange={event => setReason(event.target.value)}>{["Зависает или повторяет кадры", "Нет звука или звук отстаёт", "Не открывается", "Другая проблема"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Время сбоя, секунды<input type="number" min="0" step="1" required value={time} onChange={event => setTime(Math.max(0, Number(event.target.value)))} /></label>
      <label>Комментарий<textarea maxLength={1000} rows={3} value={comment} onChange={event => setComment(event.target.value)} placeholder="Что происходит при просмотре?" /></label>
      {error && <p role="alert">{error}</p>}
      <div><button type="submit">Сохранить отметку</button><button type="button" onClick={() => setOpen(false)}>Отмена</button>{problem && <button type="button" onClick={() => save(true)}>Снять отметку</button>}</div>
    </form>}
  </section>;
}

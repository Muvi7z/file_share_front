import { useEffect, useState } from "react";
import { Flag } from "lucide-react";
import { createVideoReport } from "./api";

type Problem = {
  id?: string;
  reason: string;
  comment: string;
  positionSecond: number;
  createdAt: string;
};
const eventName = "vault-video-problem";
const key = (id: string) => `vault-video-problem:${id}`;
function read(id: string): Problem | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key(id)) || "null") as (Problem & { time?: number }) | null;
    if (!saved) return null;
    return {
      ...saved,
      positionSecond: saved.positionSecond ?? saved.time ?? 0
    };
  } catch {
    return null;
  }
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
  if (!problem) return null;
  const sent = Boolean(problem.id);
  return <span className="video-problem-badge" title={`${sent ? "Жалоба отправлена" : "Неотправленная отметка"}: ${problem.reason}`}><Flag size={13} />{sent ? "Жалоба отправлена" : "Не отправлено"}</span>;
}
export function VideoProblemControl({ id, title, getTime }: { id: string; title: string; getTime: () => number }) {
  const problem = useProblem(id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("Зависает или повторяет кадры");
  const [comment, setComment] = useState("");
  const [time, setTime] = useState(0);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function submit() {
    const createdAt = new Date().toISOString();
    setSending(true);
    setError("");

    try {
      const report = await createVideoReport({
        videoId: id,
        title,
        reason,
        positionSecond: Math.max(0, Math.floor(time)),
        comment: comment.trim(),
        status: "open",
        createdAt
      });
      try {
        localStorage.setItem(key(id), JSON.stringify({
          id: report.id,
          reason: report.reason,
          comment: report.comment,
          positionSecond: report.positionSecond,
          createdAt: report.createdAt
        } satisfies Problem));
        window.dispatchEvent(new Event(eventName));
      } catch {
        // The report is already stored on the server; a local badge is optional.
      }
      setOpen(false);
    } catch {
      setError("Не удалось отправить жалобу. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  }

  return <section className="video-problem-control">
    <button className="icon-text" onClick={() => {
      setReason(problem?.reason ?? "Зависает или повторяет кадры"); setComment(problem?.comment ?? "");
      setTime(problem?.positionSecond ?? Math.floor(getTime())); setError(""); setOpen(value => !value);
    }} aria-expanded={open}><Flag size={17} />{problem?.id ? "Жалоба отправлена" : "Сообщить о проблеме"}</button>
    {problem && !open && <small role="status">{problem.id ? "Отправлено администратору" : "Старая локальная отметка ещё не отправлена"} · {problem.reason}</small>}
    {open && <form className="video-problem-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h2>Проблема с видео</h2>
      <p>Жалоба будет отправлена администратору вместе с названием видео и временем сбоя.</p>
      <label>Причина<select disabled={sending} value={reason} onChange={event => setReason(event.target.value)}>{["Зависает или повторяет кадры", "Нет звука или звук отстаёт", "Не открывается", "Другая проблема"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Время сбоя, секунды<input disabled={sending} type="number" min="0" step="1" required value={time} onChange={event => setTime(Math.max(0, Number(event.target.value)))} /></label>
      <label>Комментарий<textarea disabled={sending} maxLength={1000} rows={3} value={comment} onChange={event => setComment(event.target.value)} placeholder="Что происходит при просмотре?" /></label>
      {error && <p role="alert">{error}</p>}
      <div><button type="submit" disabled={sending}>{sending ? "Отправка…" : "Отправить жалобу"}</button><button type="button" disabled={sending} onClick={() => setOpen(false)}>Отмена</button></div>
    </form>}
  </section>;
}

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Ban, Check, CircleX, Clock3, X, Users, Inbox, Folder, LogOut, RefreshCw, Trash2, Save, Shield, KeyRound } from "lucide-react";
import { changePassword, deleteAccount, getAccounts, getInactiveAccountStatus, loginAdmin, registerUser, revokeSessions, updateAccount, type InactiveAccountStatus } from "./api";
import type { Account, AdminSession } from "./types";

export const isAdministrator = (session: AdminSession | null) => session?.role === "admin";
const statusNames = { pending: "Ожидает", active: "Активен", blocked: "Заблокирован", rejected: "Отклонён" };
const message = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить действие";

const authStatusContent = {
  pending: {
    title: "Статус аккаунта: на рассмотрении",
    description: "Заявка уже отправлена администратору. Вход станет доступен после одобрения.",
    icon: Clock3
  },
  blocked: {
    title: "Статус аккаунта: заблокирован",
    description: "Доступ к аккаунту временно закрыт. Обратитесь к администратору.",
    icon: Ban
  },
  rejected: {
    title: "Статус аккаунта: заявка отклонена",
    description: "Администратор отклонил заявку на доступ.",
    icon: CircleX
  }
} satisfies Record<InactiveAccountStatus, { title: string; description: string; icon: typeof Clock3 }>;

export function AccountAuthStatus({ status }: { status: InactiveAccountStatus }) {
  const content = authStatusContent[status];
  const Icon = content.icon;
  return <div className={`auth-account-status ${status}`} role="status">
    <Icon size={22} aria-hidden="true" />
    <div><strong>{content.title}</strong><span>{content.description}</span></div>
  </div>;
}

export function AccountCenter({ session, onLogin, onLogout, children }: {
  session: AdminSession | null; onLogin: (value: AdminSession) => void; onLogout: () => void; children: ReactNode;
}) {
  const [tab, setTab] = useState("requests");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [notice, setNotice] = useState("");
  const admin = isAdministrator(session);
  const refresh = useCallback(async () => {
    try { const result = await getAccounts(); if (!Array.isArray(result)) throw new Error("Некорректный ответ сервера"); setAccounts(result); setError(""); }
    catch (e) { setError(message(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (!admin) return;
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
    return () => window.clearInterval(timer);
  }, [admin, refresh]);
  async function act(task: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { await task(); setNotice(success); await refresh(); } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  if (!session) return <AuthForm onLogin={onLogin} />;
  const pending = accounts.filter(a => a.status === "pending").length;
  const filtered = accounts.filter(a => (tab !== "requests" || a.status === "pending") &&
    (tab === "requests" || status === "all" || a.status === status) && a.login.toLowerCase().includes(query.toLowerCase()));
  return <section className="account-center">
    <header className="topbar"><div><p className="eyebrow">VIDEO VAULT / {session.login}</p><h1>{admin ? "Управление" : "Мой аккаунт"}</h1></div>
      <button className="ghost-button" onClick={onLogout}><LogOut size={18} />Выйти</button></header>
    {admin && <><div className="account-stats"><span><strong>{accounts.length}</strong> аккаунтов</span><span><strong>{pending}</strong> заявок</span><span><strong>{accounts.filter(a => a.status === "active").length}</strong> активных</span></div>
      <nav className="account-tabs" aria-label="Разделы управления">
        <button aria-current={tab === "requests" ? "page" : undefined} onClick={() => setTab("requests")}><Inbox size={18} />Заявки <b>{pending}</b></button>
        <button aria-current={tab === "users" ? "page" : undefined} onClick={() => setTab("users")}><Users size={18} />Пользователи</button>
        <button aria-current={tab === "library" ? "page" : undefined} onClick={() => setTab("library")}><Folder size={18} />Медиатека</button>
        <button aria-current={tab === "profile" ? "page" : undefined} onClick={() => setTab("profile")}><Shield size={18} />Мой аккаунт</button>
      </nav></>}
    {(!admin || tab === "profile") ? <PasswordForm /> : tab === "library" ? <div className="library-admin">{children}</div> : <>
      <div className="account-toolbar"><input aria-label="Поиск пользователей" placeholder="Поиск по логину" value={query} onChange={e => setQuery(e.target.value)} />
        {tab === "users" && <select aria-label="Статус" value={status} onChange={e => setStatus(e.target.value)}><option value="all">Все статусы</option>{Object.entries(statusNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}
        <button className="icon-button" title="Обновить" disabled={busy} onClick={() => void refresh()}><RefreshCw size={18} /></button></div>
      {error && <p className="error" role="alert">{error}</p>}{notice && <p className="account-notice" role="status">{notice}</p>}
      {loading ? <p role="status">Загрузка пользователей…</p> : filtered.length === 0 ? <p className="account-empty">{error ? "Список недоступен" : tab === "requests" ? "Нет новых заявок" : "Пользователи не найдены"}</p> :
        <div className="account-list">{filtered.map(account => <AccountRow key={`${account.id}-${account.login}-${account.role}-${account.status}`} account={account} self={account.id === session.userId || account.login === session.login} busy={busy}
          onSave={patch => void act(() => updateAccount(account.id, patch), "Изменения сохранены")}
          onDelete={() => { if (window.confirm(`Удалить аккаунт ${account.login}? Это действие нельзя отменить.`)) void act(() => deleteAccount(account.id), "Аккаунт удалён"); }}
          onRevoke={() => { if (window.confirm(`Завершить все сеансы ${account.login}?`)) void act(() => revokeSessions(account.id), "Сеансы завершены"); }} />)}</div>}
    </>}
  </section>;
}

function AuthForm({ onLogin }: { onLogin: (value: AdminSession) => void }) {
  const [register, setRegister] = useState(false);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accountStatus, setAccountStatus] = useState<InactiveAccountStatus | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget;
    if (register && password !== confirm) { setError("Пароли не совпадают"); return; }
    setBusy(true); setError(""); setNotice(""); setAccountStatus(null);
    try { if (register) { const result = await registerUser({ login: login.trim(), password }); form.reset(); setLogin(""); setPassword(""); setConfirm(""); setAccountStatus(result.status === "pending" ? "pending" : null); }
      else { onLogin(await loginAdmin(login.trim(), password)); }
    } catch (err) { const nextStatus = getInactiveAccountStatus(err); if (nextStatus) setAccountStatus(nextStatus); else setError(message(err)); } finally { setBusy(false); }
  }
  return <section className="account-center auth-center"><p className="eyebrow">VIDEO VAULT</p><h1>{register ? "Создать аккаунт" : "Вход в аккаунт"}</h1>
    <div className="account-tabs"><button disabled={busy} aria-current={!register ? "page" : undefined} onClick={() => { setRegister(false); setPassword(""); setConfirm(""); setError(""); setNotice(""); setAccountStatus(null); }}>Вход</button><button disabled={busy} aria-current={register ? "page" : undefined} onClick={() => { setRegister(true); setPassword(""); setConfirm(""); setError(""); setNotice(""); setAccountStatus(null); }}>Регистрация</button></div>
    <form className="account-form" onSubmit={submit}><label>Логин<input name="login" required autoComplete="username" maxLength={64} value={login} onChange={event => { setLogin(event.target.value); setAccountStatus(null); }} /></label>
      <label>Пароль<input name="password" type="password" required autoComplete={register ? "new-password" : "current-password"} value={password} onChange={event => { setPassword(event.target.value); setAccountStatus(null); }} /></label>
      {register && <label>Повторите пароль<input name="confirm" type="password" required autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} /></label>}
      {error && <p className="error" role="alert">{error}</p>}{notice && <p className="account-notice" role="status">{notice}</p>}{accountStatus && <AccountAuthStatus status={accountStatus} />}
      {!register && <button type="button" className="credential-fill-button" disabled={busy} onClick={() => { setLogin("admin"); setPassword("admin"); setError(""); setAccountStatus(null); }}><KeyRound size={18} /><span>Заполнить admin / admin</span></button>}
      <button className="primary-button" disabled={busy}>{busy ? "Отправка…" : register ? "Отправить заявку" : "Войти"}</button></form></section>;
}

function AccountRow({ account, self, busy, onSave, onDelete, onRevoke }: {
  account: Account; self: boolean; busy: boolean; onSave: (patch: Partial<Account>) => void; onDelete: () => void; onRevoke: () => void;
}) {
  const [login, setLogin] = useState(account.login);
  return <article className="account-row"><div className="account-avatar">{account.login.slice(0, 2).toUpperCase()}</div>
    <div className="account-identity"><input aria-label={`Логин ${account.login}`} value={login} onChange={e => setLogin(e.target.value)} disabled={busy || self} /><small>{new Date(account.createdAt).toLocaleDateString("ru-RU")}{self ? " · Вы" : ""}</small></div>
    <span className={`account-status ${account.status}`}>{statusNames[account.status]}</span>
    <select aria-label={`Роль ${account.login}`} value={account.role} disabled={busy || self || account.status !== "active"} onChange={e => { const role = e.target.value as Account["role"]; if (window.confirm(`Изменить роль ${account.login} на ${role === "admin" ? "администратора" : "пользователя"}?`)) onSave({ role }); }}><option value="user">Пользователь</option><option value="admin">Администратор</option></select>
    <div className="account-actions"><button className="icon-button" title="Сохранить логин" disabled={busy || !login.trim() || login === account.login} onClick={() => onSave({ login: login.trim() })}><Save size={18} /></button>
      {account.status === "pending" ? <><button className="icon-button" title="Одобрить заявку" disabled={busy} onClick={() => onSave({ status: "active" })}><Check size={18} /></button><button className="icon-button" title="Отклонить заявку" disabled={busy} onClick={() => onSave({ status: "rejected" })}><X size={18} /></button></> : <button className="icon-button" disabled={busy || self} title={account.status === "active" ? "Заблокировать" : "Активировать"} onClick={() => onSave({ status: account.status === "active" ? "blocked" : "active" })}>{account.status === "active" ? <Shield size={18} /> : <Check size={18} />}</button>}
      <button className="icon-button" title="Завершить сеансы" disabled={busy || self} onClick={onRevoke}><KeyRound size={18} /></button><button className="danger-button" title="Удалить аккаунт" disabled={busy || self} onClick={onDelete}><Trash2 size={18} /></button></div></article>;
}

function PasswordForm() {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; const data = new FormData(form); setError(""); setNotice("");
    if (data.get("password") !== data.get("confirm")) { setError("Пароли не совпадают"); return; }
    setBusy(true); try { await changePassword(String(data.get("current")), String(data.get("password"))); form.reset(); setNotice("Пароль изменён"); } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  return <form className="account-form" onSubmit={submit}><h2>Смена пароля</h2><label>Текущий пароль<input name="current" type="password" required autoComplete="current-password" /></label><label>Новый пароль<input name="password" type="password" required autoComplete="new-password" /></label><label>Повторите пароль<input name="confirm" type="password" required autoComplete="new-password" /></label>{error && <p className="error" role="alert">{error}</p>}{notice && <p role="status" className="account-notice">{notice}</p>}<button className="primary-button" disabled={busy}>Сохранить пароль</button></form>;
}

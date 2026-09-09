import type {
  AdminSession,
  Account,
  AccountStatus,
  FileBrowserEntry,
  Folder,
  ServerFolderBrowseResponse,
  VideoFile
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type InactiveAccountStatus = Exclude<AccountStatus, "active">;

export function getInactiveAccountStatus(error: unknown): InactiveAccountStatus | null {
  if (!(error instanceof ApiError)) {
    return null;
  }

  switch (error.code) {
    case "account_pending":
      return "pending";
    case "account_blocked":
      return "blocked";
    case "account_rejected":
      return "rejected";
    default:
      return null;
  }
}

const sessionStorageKey = "local-video-vault-admin";
export const authExpiredEvent = "local-video-vault-auth-expired";
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "/api";
const apiFallbackBaseUrl = (import.meta.env.VITE_API_FALLBACK_BASE_URL as string | undefined)?.replace(/\/$/, "")
  || "http://10.0.85.2:5544/api";

function authToken() {
  const raw = localStorage.getItem(sessionStorageKey);
  if (!raw) {
    return null;
  }

  try {
    return (JSON.parse(raw) as AdminSession).token;
  } catch {
    return null;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = authToken();
  const headers = new Headers(options.headers);

  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers });
  } catch (primaryError) {
    if (!apiFallbackBaseUrl || apiFallbackBaseUrl === apiBaseUrl) {
      throw primaryError;
    }
    response = await fetch(`${apiFallbackBaseUrl}${path}`, { ...options, headers });
  }
  if (response.status === 401 && token) {
    localStorage.removeItem(sessionStorageKey);
    window.dispatchEvent(new Event(authExpiredEvent));
  }
  if (!response.ok) {
    let message = `API error ${response.status}`;
    let code: string | undefined;
    try {
      const payload = (await response.json()) as { message?: unknown; error?: unknown; code?: unknown };
      if (typeof payload.message === "string" && payload.message) {
        message = payload.message;
      } else if (typeof payload.error === "string" && payload.error) {
        message = payload.error;
      }
      if (typeof payload.code === "string" && payload.code) {
        code = payload.code;
      }
    } catch {
      // Keep the HTTP status fallback when the backend does not return JSON.
    }
    throw new ApiError(message, response.status, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function requestArray<T>(path: string, options: RequestInit = {}): Promise<T[]> {
  const payload = await request<unknown>(path, options);
  return Array.isArray(payload) ? (payload as T[]) : [];
}

function normalizeFolder(folder: Folder & { videosCount?: number }): Folder {
  return {
    ...folder,
    videoCount: folder.videoCount ?? folder.videosCount ?? 0
  };
}

function normalizeFileBrowserEntry(entry: FileBrowserEntry): FileBrowserEntry {
  if (entry.type === "folder") {
    return {
      ...entry,
      folder: normalizeFolder(entry.folder)
    };
  }

  return entry;
}


export async function browseServerFolders(path: string | null): Promise<ServerFolderBrowseResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return request<ServerFolderBrowseResponse>(`/files/browse${query}`);
}


export async function getVideos(): Promise<VideoFile[]> {
  return requestArray<VideoFile>("/videos");
}

export async function getVideo(videoId: string): Promise<VideoFile> {
  return request<VideoFile>(`/videos/${encodeURIComponent(videoId)}`);
}

export async function updateVideoPoster(videoId: string, poster: File): Promise<VideoFile> {
  const body = new FormData();
  body.append("poster", poster);

  return request<VideoFile>(`/videos/${encodeURIComponent(videoId)}/poster`, {
    method: "PUT",
    body
  });
}

export async function getFolders(): Promise<Folder[]> {
  const payload = await requestArray<Folder & { videosCount?: number }>("/folders");
  return payload.map(normalizeFolder);
}

export async function getFolderEntries(folderId: string | null): Promise<FileBrowserEntry[]> {
  const path = folderId ? `/folders/${encodeURIComponent(folderId)}/entries` : "/folders/root/entries";
  const payload = await requestArray<FileBrowserEntry>(path);
  return payload.map(normalizeFileBrowserEntry);
}

export async function loginAdmin(login: string, password: string): Promise<AdminSession> {
  return request<AdminSession>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ login, password })
  });
}

export async function addFolder(path: string): Promise<{ folder: Folder }> {
  const payload = await request<{ folder: Folder & { videosCount?: number } }>("/folders", {
    method: "POST",
    body: JSON.stringify({ path })
  });
  return { ...payload, folder: normalizeFolder(payload.folder) };
}

export async function deleteFolder(folderId: string): Promise<void> {
  await request<void>(`/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
}

export async function updateFolder(folderId: string, payload: { name?: string; enabled?: boolean }): Promise<Folder> {
  const folder = await request<Folder & { videosCount?: number }>(`/folders/${encodeURIComponent(folderId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  return normalizeFolder(folder);
}

export async function rescanFolder(folderId: string): Promise<void> {
  await request<void>(`/folders/${encodeURIComponent(folderId)}/rescan`);
}

export const registerUser = (payload: { login: string; password: string }) =>
  request<{ status: AccountStatus }>("/auth/register", { method: "POST", body: JSON.stringify(payload) });
export const getAccounts = () => request<Account[]>("/admin/users");
export const updateAccount = (id: string, payload: Partial<Pick<Account, "login" | "role" | "status">>) =>
  request<Account>(`/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
export const deleteAccount = (id: string) => request<void>(`/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
export const revokeSessions = (id: string) => request<void>(`/admin/users/${encodeURIComponent(id)}/sessions`, { method: "DELETE" });
export const changePassword = (currentPassword: string, password: string) =>
  request<void>("/auth/password", { method: "PUT", body: JSON.stringify({ currentPassword, password }) });

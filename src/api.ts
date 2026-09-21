import type {
  AdminSession,
  Account,
  AccountStatus,
  FileBrowserEntry,
  Folder,
  ServerFolderBrowseResponse,
  SharedFile,
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
  || apiBaseUrl;

export function getFileDownloadUrl(fileId: string) {
  return `${apiBaseUrl}/files/${encodeURIComponent(fileId)}/download`;
}

export function getVideoPosterUrl(videoId: string, revision?: number) {
  const url = `${apiBaseUrl}/videos/${encodeURIComponent(videoId)}/poster`;
  return revision ? `${url}?v=${revision}` : url;
}

export async function deleteMediaFile(fileId: string): Promise<void> {
  await request<void>(`/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
}

export async function deleteMediaVideo(videoId: string): Promise<void> {
  await request<void>(`/videos/${encodeURIComponent(videoId)}`, { method: "DELETE" });
}

type RequestOptions = RequestInit & {
  retryWithoutAuth?: boolean;
};

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

function clearStoredSession() {
  localStorage.removeItem(sessionStorageKey);
  window.dispatchEvent(new Event(authExpiredEvent));
}

function isAuthorizationError(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

async function fetchApi(path: string, options: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(options.headers);

  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    headers.delete("Authorization");
  }

  try {
    return await fetch(`${apiBaseUrl}${path}`, { ...options, headers });
  } catch (primaryError) {
    if (!apiFallbackBaseUrl || apiFallbackBaseUrl === apiBaseUrl) {
      throw primaryError;
    }
    return fetch(`${apiFallbackBaseUrl}${path}`, { ...options, headers });
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { retryWithoutAuth = false, ...requestOptions } = options;
  const token = authToken();

  let response = await fetchApi(path, requestOptions, token);
  const authorizationFailed = response.status === 401 || response.status === 403;
  if (authorizationFailed && token && retryWithoutAuth) {
    clearStoredSession();
    response = await fetchApi(path, requestOptions, null);
  } else if (response.status === 401 && token) {
    clearStoredSession();
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

async function requestArray<T>(path: string, options: RequestOptions = {}): Promise<T[]> {
  const payload = await request<unknown>(path, options);
  return Array.isArray(payload) ? (payload as T[]) : [];
}

function normalizeFolder(folder: Folder & { videosCount?: number }): Folder {
  return {
    ...folder,
    videoCount: folder.videoCount ?? folder.videosCount ?? 0
  };
}

function normalizeFileExtension(extension: string | undefined, fileName: string): string {
  const explicitExtension = extension?.trim().replace(/^\.+/, "");
  if (explicitExtension) {
    return explicitExtension.toLowerCase();
  }

  const match = fileName.match(/\.([^./\\]+)$/);
  return match?.[1]?.toLowerCase() ?? "";
}

function inferMimeType(extension: string): string | undefined {
  const mimeTypes: Record<string, string> = {
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
    csv: "text/csv",
    json: "application/json",
    pdf: "application/pdf",
    txt: "text/plain",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
    webm: "video/webm",
    zip: "application/zip"
  };

  return mimeTypes[extension];
}

function normalizeFile(file: SharedFile): SharedFile {
  const extension = normalizeFileExtension(file.extension, file.name);

  return {
    ...file,
    folderName: file.folderName ?? "",
    parentFolderId: file.parentFolderId ?? "",
    extension,
    mimeType: file.mimeType || inferMimeType(extension)
  };
}

function normalizeFileBrowserEntry(entry: FileBrowserEntry): FileBrowserEntry {
  if (entry.type === "folder") {
    return {
      ...entry,
      folder: normalizeFolder(entry.folder)
    };
  }

  if (entry.type === "file") {
    return {
      ...entry,
      file: normalizeFile(entry.file)
    };
  }

  return entry;
}


export async function browseServerFolders(path: string | null): Promise<ServerFolderBrowseResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return request<ServerFolderBrowseResponse>(`/files/browse${query}`);
}


export async function getVideos(): Promise<VideoFile[]> {
  return requestArray<VideoFile>("/videos", { retryWithoutAuth: true });
}

export async function getVideo(videoId: string): Promise<VideoFile> {
  try {
    return await request<VideoFile>(`/videos/${encodeURIComponent(videoId)}`, { retryWithoutAuth: true });
  } catch (error) {
    if (!isAuthorizationError(error)) {
      throw error;
    }

    const video = (await getVideos()).find((item) => item.id === videoId);
    if (!video) {
      throw error;
    }
    return video;
  }
}

export async function updateVideoPoster(videoId: string, poster: File): Promise<VideoFile> {
  const body = new FormData();
  body.append("poster", poster);

  await request<unknown>(`/videos/${encodeURIComponent(videoId)}/poster`, {
    method: "PUT",
    body
  });

  return getVideo(videoId);
}

export async function getFolders(): Promise<Folder[]> {
  const payload = await requestArray<Folder & { videosCount?: number }>("/folders", { retryWithoutAuth: true });
  return payload.map(normalizeFolder);
}

export async function getFolderEntries(folderId: string | null): Promise<FileBrowserEntry[]> {
  const path = folderId ? `/folders/${encodeURIComponent(folderId)}/entries` : "/folders/root/entries";
  try {
    const payload = await requestArray<FileBrowserEntry>(path, { retryWithoutAuth: true });
    return payload.map(normalizeFileBrowserEntry);
  } catch (error) {
    if (!isAuthorizationError(error)) {
      throw error;
    }

    const [folders, videos] = await Promise.all([getFolders(), getVideos()]);
    const folderEntries: FileBrowserEntry[] = folders
      .filter((folder) => folderId ? folder.parentId === folderId : folder.isRoot)
      .map((folder) => ({ type: "folder", folder }));
    const videoEntries: FileBrowserEntry[] = folderId
      ? videos
          .filter((video) => video.parentFolderId === folderId)
          .map((video) => ({ type: "video", video }))
      : [];

    return [...folderEntries, ...videoEntries];
  }
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

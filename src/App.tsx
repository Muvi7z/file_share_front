import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  HardDrive,
  List,
  Lock,
  LogOut,
  MonitorPlay,
  Pencil,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings,
  Shield,
  Trash2,
  X
} from "lucide-react";
import {
  addFolder,
  browseServerFolders,
  deleteFolder,
  getFolderEntries,
  getFolders,
  getVideo,
  getVideos,
  loginAdmin,
  rescanFolder,
  updateFolder
} from "./api";
import type {
  AdminSession,
  FileBrowserEntry,
  Folder as VaultFolder,
  Page,
  ServerFolderBrowseResponse,
  ServerFolderEntry,
  VideoFile,
  ViewMode
} from "./types";

const sessionStorageKey = "local-video-vault-admin";
const unknownFolderName = "\u041f\u0430\u043f\u043a\u0430 \u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430";

function normalizeVideoPath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function getVideoDedupeKey(video: VideoFile) {
  return normalizeVideoPath(video.path) || video.id;
}

function isUnknownFolderVideo(video: VideoFile, knownFolderIds: Set<string>) {
  const hasKnownParent = Boolean(video.parentFolderId && knownFolderIds.has(video.parentFolderId));
  const hasKnownRoot = Boolean(video.folderId && knownFolderIds.has(video.folderId));

  return video.folderName === unknownFolderName || !hasKnownParent || !hasKnownRoot;
}

function withFolderFallback(video: VideoFile, knownFolderIds: Set<string>): VideoFile {
  if (!isUnknownFolderVideo(video, knownFolderIds)) {
    return video;
  }

  return {
    ...video,
    folderName: unknownFolderName
  };
}

function toUnknownFolderVideoEntry(video: VideoFile, knownFolderIds: Set<string>): FileBrowserEntry | null {
  if (!isUnknownFolderVideo(video, knownFolderIds)) {
    return null;
  }

  return {
    type: "video",
    video: withFolderFallback(video, knownFolderIds)
  };
}

type RouteState = {
  page: Page;
  currentFolderId: string | null;
  selectedFolder: string;
  query: string;
  viewMode: ViewMode;
  videoId: string | null;
};

function readRouteState(): RouteState {
  const params = new URLSearchParams(window.location.search);
  const page = params.get("page");
  const view = params.get("view");

  return {
    page: page === "files" || page === "player" || page === "admin" ? page : "videos",
    currentFolderId: params.get("folder"),
    selectedFolder: params.get("selected") || "all",
    query: params.get("q") || "",
    viewMode: view === "list" ? "list" : "tiles",
    videoId: params.get("video")
  };
}

function App() {
  const [initialRouteState] = useState(readRouteState);
  const contentRef = useRef<HTMLElement | null>(null);
  const playerReturnPageRef = useRef<Page>(initialRouteState.page === "player" ? "files" : initialRouteState.page);
  const returnScrollTopRef = useRef(0);
  const pendingScrollRestoreRef = useRef<number | null>(null);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [fileEntries, setFileEntries] = useState<FileBrowserEntry[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(initialRouteState.currentFolderId);
  const [page, setPage] = useState<Page>(initialRouteState.page);
  const [selectedFolder, setSelectedFolder] = useState(initialRouteState.selectedFolder);
  const [query, setQuery] = useState(initialRouteState.query);
  const [viewMode, setViewMode] = useState<ViewMode>(initialRouteState.viewMode);
  const [selectedVideo, setSelectedVideo] = useState<VideoFile | null>(null);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(initialRouteState.videoId);
  const [loadError, setLoadError] = useState("");
  const [session, setSession] = useState<AdminSession | null>(() => {
    const raw = localStorage.getItem(sessionStorageKey);
    return raw ? (JSON.parse(raw) as AdminSession) : null;
  });

  const refreshData = useCallback(async () => {
    try {
      setLoadError("");
      const [videoList, folderList] = await Promise.all([getVideos(), getFolders()]);
      setVideos(Array.isArray(videoList) ? videoList : []);
      setFolders(Array.isArray(folderList) ? folderList : []);
    } catch (nextError) {
      setLoadError(nextError instanceof Error ? nextError.message : "Не удалось загрузить данные.");
      setVideos([]);
      setFolders([]);
      setFileEntries([]);
    }
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    const params = new URLSearchParams();

    if (page !== "videos") {
      params.set("page", page);
    }
    if (currentFolderId) {
      params.set("folder", currentFolderId);
    }
    if (selectedFolder !== "all") {
      params.set("selected", selectedFolder);
    }
    if (query.trim()) {
      params.set("q", query);
    }
    if (viewMode !== "tiles") {
      params.set("view", viewMode);
    }
    if (page === "player") {
      const videoId = selectedVideo?.id ?? activeVideoId;
      if (videoId) {
        params.set("video", videoId);
      }
    }

    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, [activeVideoId, currentFolderId, page, query, selectedFolder, selectedVideo, viewMode]);

  useEffect(() => {
    if (page !== "player" || selectedVideo || !activeVideoId) {
      return;
    }

    let isCurrent = true;
    const restoredVideo = videos.find((video) => video.id === activeVideoId);
    if (restoredVideo) {
      setSelectedVideo(restoredVideo);
      return () => {
        isCurrent = false;
      };
    }

    getVideo(activeVideoId)
      .then((video) => {
        if (isCurrent) {
          setSelectedVideo(video);
        }
      })
      .catch((nextError) => {
        if (isCurrent) {
          setLoadError(nextError instanceof Error ? nextError.message : "Не удалось открыть видео.");
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [activeVideoId, page, selectedVideo, videos]);

  useEffect(() => {
    let isCurrent = true;

    getFolderEntries(currentFolderId)
      .then((entries) => {
        if (isCurrent) {
          setFileEntries(Array.isArray(entries) ? entries : []);
        }
      })
      .catch((nextError) => {
        if (isCurrent) {
          setLoadError(nextError instanceof Error ? nextError.message : "Не удалось загрузить папку.");
          setFileEntries([]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [currentFolderId, folders]);

  const rootFolders = folders.filter((folder) => folder.isRoot);
  const isAdminSession = Boolean(session);
  const enabledFolders = rootFolders.filter((folder) => folder.enabled);
  const visibleRootFolders = isAdminSession ? rootFolders : enabledFolders;
  const currentFolder = folders.find((folder) => folder.id === currentFolderId) ?? null;
  const breadcrumbs = useMemo(() => buildBreadcrumbs(currentFolder, folders), [currentFolder, folders]);

  const filteredVideos = useMemo(() => {
    return videos.filter((video) => {
      const folderIsVisible = visibleRootFolders.some((folder) => folder.id === video.folderId);
      const matchesFolder = selectedFolder === "all" || video.folderId === selectedFolder;
      const matchesQuery = [video.title, video.folderName, video.codec, video.resolution]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase().trim());

      return folderIsVisible && matchesFolder && matchesQuery;
    });
  }, [query, selectedFolder, videos, visibleRootFolders]);

  const visibleFileEntries = useMemo(() => {
    const entries =
      currentFolderId === null
        ? (() => {
            const knownFolderIds = new Set(folders.map((folder) => folder.id));
            const listedVideoKeys = new Set<string>();
            const mergedEntries: FileBrowserEntry[] = [];

            fileEntries.forEach((entry) => {
              if (entry.type === "folder") {
                mergedEntries.push(entry);
                return;
              }

              const videoEntry = toUnknownFolderVideoEntry(entry.video, knownFolderIds);
              if (!videoEntry) {
                return;
              }

              const key = getVideoDedupeKey(entry.video);
              if (listedVideoKeys.has(key)) {
                return;
              }

              listedVideoKeys.add(key);
              mergedEntries.push(videoEntry);
            });

            videos.forEach((video) => {
              const videoEntry = toUnknownFolderVideoEntry(video, knownFolderIds);
              if (!videoEntry) {
                return;
              }

              const key = getVideoDedupeKey(video);
              if (listedVideoKeys.has(key)) {
                return;
              }

              listedVideoKeys.add(key);
              mergedEntries.push(videoEntry);
            });

            return mergedEntries;
          })()
        : fileEntries;
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) {
      return entries;
    }

    return entries.filter((entry) => {
      if (entry.type === "folder") {
        return entry.folder.name.toLowerCase().includes(normalizedQuery);
      }

      return [entry.video.title, entry.video.folderName, entry.video.codec, entry.video.resolution]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [currentFolderId, fileEntries, folders, query, videos]);

  const isMobileLayout = () => window.matchMedia("(max-width: 860px)").matches;

  const getCurrentScrollTop = () => {
    if (isMobileLayout()) {
      return window.scrollY;
    }

    return contentRef.current?.scrollTop ?? window.scrollY;
  };

  const scrollToTop = () => {
    if (isMobileLayout()) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const restoreScrollPosition = (top: number) => {
    if (isMobileLayout()) {
      window.scrollTo({ top, behavior: "auto" });
      return;
    }

    contentRef.current?.scrollTo({ top, behavior: "auto" });
  };

  useEffect(() => {
    if (page === "player" || pendingScrollRestoreRef.current === null) {
      return;
    }

    const nextScrollTop = pendingScrollRestoreRef.current;
    pendingScrollRestoreRef.current = null;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => restoreScrollPosition(nextScrollTop));
    });
  }, [filteredVideos.length, page, visibleFileEntries.length]);

  const openPage = (nextPage: Page) => {
    setPage(nextPage);
    setSelectedVideo(null);
    if (nextPage !== "player") {
      setActiveVideoId(null);
    }
    scrollToTop();
  };

  const openPlayer = (video: VideoFile) => {
    playerReturnPageRef.current = page === "player" ? "files" : page;
    returnScrollTopRef.current = getCurrentScrollTop();
    setSelectedVideo(video);
    setActiveVideoId(video.id);
    setPage("player");
    scrollToTop();
  };

  const closePlayer = () => {
    pendingScrollRestoreRef.current = returnScrollTopRef.current;
    setPage(playerReturnPageRef.current);
    setSelectedVideo(null);
    setActiveVideoId(null);
  };

  const handleLogin = (nextSession: AdminSession) => {
    localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
    setSession(nextSession);
    refreshData();
  };

  const handleLogout = () => {
    localStorage.removeItem(sessionStorageKey);
    setSession(null);
    refreshData();
  };

  const handleFolderCreated = ({ folder }: { folder: VaultFolder }) => {
    setFolders((current) => [folder, ...current]);
  };

  const handleFolderUpdated = (folder: VaultFolder) => {
    setFolders((current) => current.map((item) => (item.id === folder.id ? folder : item)));
  };

  const handleFolderDeleted = async (folderId: string) => {
    await deleteFolder(folderId);
    await refreshData();

    if (selectedFolder === folderId) {
      setSelectedFolder("all");
    }

    const deletedFolderIds = new Set(folders.filter((folder) => folder.rootFolderId === folderId).map((item) => item.id));
    if (currentFolderId && deletedFolderIds.has(currentFolderId)) {
      setCurrentFolderId(null);
    }
  };

  const pageTitle = page === "files" ? "Все файлы" : page === "admin" ? "Админка" : "Видео в локальной сети";
  const pageEyebrow = page === "files" ? "Проводник" : page === "admin" ? "Доступ и папки" : "Открытый просмотр";

  return (
    <div className={`app-shell page-${page}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <span className="brand-play-triangle" />
          </span>
          <div>
            <strong>Video Vault</strong>
            <span>LAN media browser</span>
          </div>
        </div>

        <nav className="main-nav" aria-label="Основные разделы">
          <button className={page === "videos" ? "active" : ""} onClick={() => openPage("videos")}>
            <Grid2X2 size={18} />
            <span>Видео</span>
          </button>
          <button className={page === "files" ? "active" : ""} onClick={() => openPage("files")}>
            <FolderOpen size={18} />
            <span>Все файлы</span>
          </button>
          <button className={page === "admin" ? "active" : ""} onClick={() => openPage("admin")}>
            <Settings size={18} />
            <span>Админка</span>
          </button>
        </nav>

        <nav className="folder-nav" aria-label="Папки">
          <button className={selectedFolder === "all" ? "active" : ""} onClick={() => setSelectedFolder("all")}>
            <span>Все видео</span>
            <b>{videos.length}</b>
          </button>
          {visibleRootFolders.map((folder) => (
            <button
              key={folder.id}
              className={selectedFolder === folder.id ? "active" : ""}
              onClick={() => {
                setSelectedFolder(folder.id);
                openPage("videos");
              }}
            >
              <span>{folder.name}</span>
              <b>{folder.filesCount}</b>
            </button>
          ))}
        </nav>
      </aside>

      <main ref={contentRef} className={page === "player" ? "content player-page" : "content"}>
        {page === "player" && selectedVideo ? (
          <PlayerPage video={selectedVideo} onBack={closePlayer} />
        ) : page === "player" ? (
          <section className="empty-folder">
            <MonitorPlay size={34} />
            <h2>Загрузка видео</h2>
            <p>Восстанавливаем открытый плеер после обновления страницы.</p>
          </section>
        ) : page === "admin" ? (
          <AdminPage
            folders={rootFolders}
            session={session}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onFolderCreated={handleFolderCreated}
            onFolderUpdated={handleFolderUpdated}
            onFolderDeleted={handleFolderDeleted}
          />
        ) : (
          <>
            <header className="topbar">
              <div>
                <p className="eyebrow">{pageEyebrow}</p>
                <h1>{pageTitle}</h1>
              </div>
              <button className="icon-text" onClick={() => openPage("admin")}>
                <Shield size={18} />
                <span>{session ? session.login : "Войти"}</span>
              </button>
            </header>
            {loadError && <p className="error app-error">{loadError}</p>}

            <section className="toolbar" aria-label="Фильтры">
              <label className="search-box">
                <Search size={18} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={page === "files" ? "Поиск по папкам и видео" : "Поиск по названию, папке, кодеку"}
                />
              </label>

              <div className="segmented" role="group" aria-label="Вид списка">
                <button
                  className={viewMode === "tiles" ? "selected" : ""}
                  onClick={() => setViewMode("tiles")}
                  title="Плитка"
                >
                  <Grid2X2 size={18} />
                </button>
                <button
                  className={viewMode === "list" ? "selected" : ""}
                  onClick={() => setViewMode("list")}
                  title="Список"
                >
                  <List size={18} />
                </button>
              </div>
            </section>

            {page === "files" ? (
              <FileBrowser
                entries={visibleFileEntries}
                breadcrumbs={breadcrumbs}
                currentFolder={currentFolder}
                viewMode={viewMode}
                onOpenFolder={(folder) => setCurrentFolderId(folder.id)}
                onOpenRoot={() => setCurrentFolderId(null)}
                onOpenVideo={openPlayer}
              />
            ) : (
              <>
                <section className="stats-row" aria-label="Статистика">
                  <Stat label="Файлы" value={filteredVideos.length.toString()} />
                  <Stat label="Папки" value={visibleRootFolders.length.toString()} />
                  <Stat label="Доступ" value={isAdminSession ? "Админ" : "Публичный"} />
                </section>

                <section className={viewMode === "tiles" ? "video-grid" : "video-list"} aria-label="Видео">
                  {filteredVideos.map((video) => (
                    <VideoItem key={video.id} video={video} mode={viewMode} onPlay={() => openPlayer(video)} />
                  ))}
                </section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function buildBreadcrumbs(currentFolder: VaultFolder | null, folders: VaultFolder[]) {
  const result: VaultFolder[] = [];
  let cursor = currentFolder;

  while (cursor) {
    result.unshift(cursor);
    cursor = folders.find((folder) => folder.id === cursor?.parentId) ?? null;
  }

  return result;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FileBrowser({
  entries,
  breadcrumbs,
  currentFolder,
  viewMode,
  onOpenFolder,
  onOpenRoot,
  onOpenVideo
}: {
  entries: FileBrowserEntry[];
  breadcrumbs: VaultFolder[];
  currentFolder: VaultFolder | null;
  viewMode: ViewMode;
  onOpenFolder: (folder: VaultFolder) => void;
  onOpenRoot: () => void;
  onOpenVideo: (video: VideoFile) => void;
}) {
  const folderCount = entries.filter((entry) => entry.type === "folder").length;
  const videoCount = entries.filter((entry) => entry.type === "video").length;

  return (
    <>
      <section className="file-crumbs" aria-label="Путь">
        <button onClick={onOpenRoot}>Все папки</button>
        {breadcrumbs.map((folder) => (
          <span key={folder.id}>
            <ChevronRight size={16} />
            <button onClick={() => onOpenFolder(folder)}>{folder.name}</button>
          </span>
        ))}
      </section>

      <section className="compact-summary" aria-label="Сводка файлов">
        <strong>{currentFolder?.name ?? "Корень"}</strong>
        <span>{folderCount} папок</span>
        <span>{videoCount} видео</span>
      </section>

      {entries.length === 0 ? (
        <section className="empty-folder">
          <FolderOpen size={34} />
          <h2>Папка пустая</h2>
          <p>Внутри нет вложенных папок и видеофайлов.</p>
        </section>
      ) : (
        <section className={viewMode === "tiles" ? "file-grid" : "file-list"} aria-label="Все файлы">
          {entries.map((entry) =>
            entry.type === "folder" ? (
              <FolderItem key={entry.folder.id} folder={entry.folder} onOpen={() => onOpenFolder(entry.folder)} />
            ) : (
              <VideoItem key={entry.video.id} video={entry.video} mode={viewMode} onPlay={() => onOpenVideo(entry.video)} />
            )
          )}
        </section>
      )}
    </>
  );
}

function FolderItem({ folder, onOpen }: { folder: VaultFolder; onOpen: () => void }) {
  const isEmpty = folder.videoCount === 0 && folder.childFolderCount === 0;

  return (
    <article className="folder-card">
      <button className="folder-open-button" onClick={onOpen} aria-label={`Открыть папку ${folder.name}`}>
        <span className="folder-icon">
          <Folder size={30} fill="currentColor" />
        </span>
        <span>
          <strong>{folder.name}</strong>
        </span>
      </button>
      <div className="folder-card-meta">
        <span>{folder.childFolderCount} папок</span>
        <span>{folder.videoCount} видео</span>
        {isEmpty && <b>Пустая</b>}
      </div>
    </article>
  );
}

function formatDuration(value: VideoFile["duration"]) {
  const totalSeconds = parseDurationSeconds(value);
  if (totalSeconds === null) {
    return String(value || "");
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = String(seconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }

  return `${minutes}:${paddedSeconds}`;
}

function parseDurationSeconds(value: VideoFile["duration"]) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (/^\d+(\.\d+)?$/.test(normalized)) {
    return Math.round(Number(normalized));
  }

  const parts = normalized.split(":");
  if (parts.length >= 2 && parts.length <= 3 && parts.every((part) => /^\d+$/.test(part))) {
    const numbers = parts.map(Number);
    if (parts.length === 2) {
      return numbers[0] * 60 + numbers[1];
    }

    return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
  }

  return null;
}

function VideoItem({ video, mode, onPlay }: { video: VideoFile; mode: ViewMode; onPlay: () => void }) {
  const duration = formatDuration(video.duration);

  return (
    <article className="video-item">
      <button className="poster-button" onClick={onPlay} aria-label={`Открыть ${video.title}`}>
        <img src={video.posterUrl} alt="" />
        <span className="play-badge">
          <Play size={18} fill="currentColor" />
        </span>
        <span className="duration">{duration}</span>
      </button>

      <div className="video-info">
        <div>
          <h2>{video.title}</h2>
          <p>{video.folderName}</p>
        </div>
        <dl>
          <div>
            <dt>Размер</dt>
            <dd>{video.size}</dd>
          </div>
          {mode === "list" && (
            <div>
              <dt>Обновлен</dt>
              <dd>{video.modifiedAt}</dd>
            </div>
          )}
        </dl>
      </div>
    </article>
  );
}

function PlayerPage({ video, onBack }: { video: VideoFile; onBack: () => void }) {
  const duration = formatDuration(video.duration);

  return (
    <>
      <header className="player-topbar">
        <button className="player-back-button" onClick={onBack} type="button" aria-label="Вернуться назад">
          <ArrowLeft size={18} />
          <span>Назад</span>
        </button>
        <div>
          <p className="eyebrow">Плеер</p>
          <h1>{video.title}</h1>
          <span>{video.path}</span>
        </div>
      </header>

      <section className="player-surface">
        <video controls autoPlay playsInline preload="auto" poster={video.posterUrl} src={video.streamUrl} />
      </section>

      <section className="player-details">
        <div>
          <FileVideo size={18} />
          <span>{video.codec}</span>
        </div>
        <div>
          <Play size={18} />
          <span>{duration}</span>
        </div>
        <div>
          <MonitorPlay size={18} />
          <span>{video.resolution}</span>
        </div>
        <div>
          <Folder size={18} />
          <span>{video.folderName}</span>
        </div>
      </section>
    </>
  );
}

function AdminPage({
  folders,
  session,
  onLogin,
  onLogout,
  onFolderCreated,
  onFolderUpdated,
  onFolderDeleted
}: {
  folders: VaultFolder[];
  session: AdminSession | null;
  onLogin: (session: AdminSession) => void;
  onLogout: () => void;
  onFolderCreated: (payload: { folder: VaultFolder }) => void;
  onFolderUpdated: (folder: VaultFolder) => void;
  onFolderDeleted: (folderId: string) => Promise<void>;
}) {
  const [login, setLogin] = useState("admin");
  const [password, setPassword] = useState("");
  const [path, setPath] = useState("D:\\Video");
  const [error, setError] = useState("");
  const [isBusy, setBusy] = useState(false);
  const [isPickerOpen, setPickerOpen] = useState(false);
  const [rescanningFolderId, setRescanningFolderId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [updatingFolderId, setUpdatingFolderId] = useState<string | null>(null);

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      onLogin(await loginAdmin(login, password));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Ошибка входа.");
    } finally {
      setBusy(false);
    }
  };

  const submitFolder = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const payload = await addFolder(path);
      onFolderCreated(payload);
      setPath("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось добавить папку.");
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async (folder: VaultFolder) => {
    const shouldDelete = window.confirm(`Удалить путь "${folder.path}" из просмотра? Файлы на диске не удалятся.`);
    if (!shouldDelete) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      await onFolderDeleted(folder.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось удалить папку.");
    } finally {
      setBusy(false);
    }
  };

  const rescanItem = async (folder: VaultFolder) => {
    setRescanningFolderId(folder.id);
    setError("");

    try {
      await rescanFolder(folder.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось запустить пересканирование.");
    } finally {
      setRescanningFolderId(null);
    }
  };

  const startEditingFolder = (folder: VaultFolder) => {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
    setError("");
  };

  const cancelEditingFolder = () => {
    setEditingFolderId(null);
    setEditingFolderName("");
  };

  const saveFolderName = async (folder: VaultFolder) => {
    const nextName = editingFolderName.trim();
    if (!nextName || nextName === folder.name) {
      cancelEditingFolder();
      return;
    }

    setUpdatingFolderId(folder.id);
    setError("");

    try {
      onFolderUpdated(await updateFolder(folder.id, { name: nextName }));
      cancelEditingFolder();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось сохранить папку.");
    } finally {
      setUpdatingFolderId(null);
    }
  };

  const toggleFolderEnabled = async (folder: VaultFolder) => {
    setUpdatingFolderId(folder.id);
    setError("");

    try {
      onFolderUpdated(await updateFolder(folder.id, { enabled: !folder.enabled }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось изменить доступность папки.");
    } finally {
      setUpdatingFolderId(null);
    }
  };

  return (
    <>
      <header className="topbar admin-topbar">
        <div>
          <p className="eyebrow">Доступ и папки</p>
          <h1>Админка</h1>
        </div>
        {session && (
          <button className="ghost-button" onClick={onLogout}>
            <LogOut size={18} />
            <span>Выйти</span>
          </button>
        )}
      </header>

      {!session ? (
        <form className="admin-form admin-page-card" onSubmit={submitLogin}>
          <label>
            Логин
            <input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" />
          </label>
          <label>
            Пароль
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary-button" disabled={isBusy}>
            <Lock size={18} />
            <span>Войти</span>
          </button>
        </form>
      ) : (
        <section className="admin-page-grid">
          <form className="add-folder admin-page-card" onSubmit={submitFolder}>
            <label>
              Путь к папке
              <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="D:\\Video" />
            </label>
            <div className="path-actions">
              <button type="button" className="ghost-button" onClick={() => setPickerOpen(true)} disabled={isBusy}>
                <FolderOpen size={18} />
                <span>Выбрать</span>
              </button>
              <button className="primary-button" disabled={isBusy || !path.trim()}>
                <FolderPlus size={18} />
                <span>Добавить</span>
              </button>
            </div>
          </form>

          {isPickerOpen && (
            <FolderPicker
              initialPath={path}
              onClose={() => setPickerOpen(false)}
              onSelect={(nextPath) => {
                setPath(nextPath);
                setPickerOpen(false);
              }}
            />
          )}

          {error && <p className="error">{error}</p>}

          <div className="folder-table admin-page-card">
            {folders.map((folder) => (
              <AdminFolderRow
                key={folder.id}
                folder={folder}
                isBusy={isBusy}
                isRescanning={rescanningFolderId === folder.id}
                isUpdating={updatingFolderId === folder.id}
                isEditing={editingFolderId === folder.id}
                editingName={editingFolderName}
                onEditingNameChange={setEditingFolderName}
                onStartEdit={() => startEditingFolder(folder)}
                onCancelEdit={cancelEditingFolder}
                onSaveEdit={() => saveFolderName(folder)}
                onToggleEnabled={() => toggleFolderEnabled(folder)}
                onRescan={() => rescanItem(folder)}
                onDelete={() => deleteItem(folder)}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function AdminFolderRow({
  folder,
  isBusy,
  isRescanning,
  isUpdating,
  isEditing,
  editingName,
  onEditingNameChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onToggleEnabled,
  onRescan,
  onDelete
}: {
  folder: VaultFolder;
  isBusy: boolean;
  isRescanning: boolean;
  isUpdating: boolean;
  isEditing: boolean;
  editingName: string;
  onEditingNameChange: (name: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onToggleEnabled: () => void;
  onRescan: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="folder-row">
      <div className="folder-name-cell">
        {isEditing ? (
          <input
            value={editingName}
            onChange={(event) => onEditingNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onSaveEdit();
              }
              if (event.key === "Escape") {
                onCancelEdit();
              }
            }}
            autoFocus
          />
        ) : (
          <strong>{folder.name}</strong>
        )}
        <span>{folder.path}</span>
      </div>

      <div className="folder-edit-actions">
        {isEditing ? (
          <>
            <button className="icon-button" onClick={onSaveEdit} disabled={isUpdating} title="Сохранить">
              <Save size={18} />
            </button>
            <button className="icon-button" onClick={onCancelEdit} disabled={isUpdating} title="Отменить">
              <X size={18} />
            </button>
          </>
        ) : (
          <button className="icon-button" onClick={onStartEdit} disabled={isBusy || isUpdating} title="Редактировать">
            <Pencil size={18} />
          </button>
        )}
      </div>

      <div className="folder-meta">
        <span>{folder.filesCount} файлов</span>
        <span>{folder.lastScanAt}</span>
      </div>
      <button className="icon-button" onClick={onRescan} disabled={isBusy || isRescanning} title="Пересканировать">
        <RefreshCw size={18} />
      </button>
      <button className={folder.enabled ? "status enabled" : "status"} onClick={onToggleEnabled} disabled={isBusy || isUpdating}>
        {folder.enabled ? "ON" : "OFF"}
      </button>
      <button className="danger-button" onClick={onDelete} disabled={isBusy || isUpdating} title="Удалить путь">
        <Trash2 size={18} />
      </button>
    </div>
  );
}

function FolderPicker({
  initialPath,
  onClose,
  onSelect
}: {
  initialPath: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const [browseState, setBrowseState] = useState<ServerFolderBrowseResponse | null>(null);
  const [currentPath, setCurrentPath] = useState(initialPath.trim() || "");
  const [error, setError] = useState("");
  const [isLoading, setLoading] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    setLoading(true);
    setError("");

    browseServerFolders(currentPath || null)
      .then((payload) => {
        if (isCurrent) {
          setBrowseState(payload);
        }
      })
      .catch((nextError) => {
        if (isCurrent) {
          setError(nextError instanceof Error ? nextError.message : "Не удалось открыть папку.");
          setBrowseState({ path: currentPath, parent: "", entries: [] });
        }
      })
      .finally(() => {
        if (isCurrent) {
          setLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [currentPath]);

  const entries = browseState?.entries ?? [];
  const selectedPath = browseState?.path || currentPath;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="folder-picker" role="dialog" aria-modal="true" aria-label="Выбор папки">
        <header className="modal-header">
          <div>
            <h2>Выбор папки</h2>
            <span>{selectedPath || "Компьютер"}</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Закрыть">
            <X size={18} />
          </button>
        </header>

        <div className="folder-picker-toolbar">
          <button className="ghost-button" onClick={() => setCurrentPath(browseState?.parent || "")} disabled={!selectedPath}>
            <ChevronRight className="rotate-180" size={18} />
            <span>Выше</span>
          </button>
          <button className="primary-button" onClick={() => onSelect(selectedPath)} disabled={!selectedPath}>
            <FolderPlus size={18} />
            <span>Выбрать</span>
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="folder-picker-list">
          {isLoading ? (
            <div className="folder-picker-empty">Загрузка</div>
          ) : entries.length === 0 ? (
            <div className="folder-picker-empty">Нет вложенных папок</div>
          ) : (
            entries.map((entry) => (
              <FolderPickerRow key={entry.path} entry={entry} onOpen={() => setCurrentPath(entry.path)} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function FolderPickerRow({ entry, onOpen }: { entry: ServerFolderEntry; onOpen: () => void }) {
  const Icon = entry.isRoot ? HardDrive : Folder;

  return (
    <button className="folder-picker-row" onClick={onOpen}>
      <Icon size={20} />
      <span>{entry.name}</span>
      <small>{entry.path}</small>
      <ChevronRight size={18} />
    </button>
  );
}

export default App;

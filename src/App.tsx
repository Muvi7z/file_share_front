import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AccountAuthStatus, AccountCenter, isAdministrator } from "./Accounts";
import {
  ArrowDown,
  Check,
  ChevronDown,
  Pause,
  RotateCcw,
  RotateCw,
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  ArrowDownAZ,
  ArrowLeft,
  ArrowUp,
  CalendarDays,
  ChevronRight,
  Download,
  File as FileIcon,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  HardDrive,
  ImagePlus,
  Image as ImageIcon,
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
  Smartphone,
  Monitor,
  Trash2,
  X
} from "lucide-react";
import {
  addFolder,
  authExpiredEvent,
  browseServerFolders,
  deleteFolder,
  getFolderEntries,
  getFileDownloadUrl,
  getFolders,
  getInactiveAccountStatus,
  getVideo,
  getVideoPosterUrl,
  getVideos,
  loginAdmin,
  rescanFolder,
  updateFolder,
  updateVideoPoster
} from "./api";
import type { InactiveAccountStatus } from "./api";
import type {
  AdminSession,
  FileBrowserEntry,
  Folder as VaultFolder,
  Page,
  ServerFolderBrowseResponse,
  ServerFolderEntry,
  SharedFile,
  VideoFile,
  ViewMode
} from "./types";

const sessionStorageKey = "local-video-vault-admin";
const unknownFolderName = "\u041f\u0430\u043f\u043a\u0430 \u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430";
const posterPreviewCache = new Map<string, string>();
const pendingPosterPreviews = new Map<string, Promise<string>>();
const posterPreviewQueue: Array<{
  url: string;
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
}> = [];
let activePosterPreviewLoads = 0;

async function createPosterPreview(url: string) {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Poster request failed: ${response.status}`);
  let blob = await response.blob();

  if ("createImageBitmap" in window && "OffscreenCanvas" in window) {
    try {
      const bitmap = await createImageBitmap(blob);
      const targetRatio = 16 / 9;
      const sourceRatio = bitmap.width / bitmap.height;
      const sourceWidth = sourceRatio > targetRatio ? bitmap.height * targetRatio : bitmap.width;
      const sourceHeight = sourceRatio > targetRatio ? bitmap.height : bitmap.width / targetRatio;
      const sourceX = (bitmap.width - sourceWidth) / 2;
      const sourceY = (bitmap.height - sourceHeight) / 2;
      const canvas = new OffscreenCanvas(480, 270);
      const context = canvas.getContext("2d", { alpha: false });
      context?.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, 480, 270);
      bitmap.close();
      if (context) blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.74 });
    } catch {
      // The original poster remains usable when off-thread resizing is unavailable.
    }
  }

  return URL.createObjectURL(blob);
}

function runPosterPreviewQueue() {
  while (activePosterPreviewLoads < 2 && posterPreviewQueue.length > 0) {
    const item = posterPreviewQueue.shift();
    if (!item) return;
    activePosterPreviewLoads += 1;
    void createPosterPreview(item.url)
      .then((previewUrl) => {
        posterPreviewCache.set(item.url, previewUrl);
        if (posterPreviewCache.size > 96) {
          const oldest = posterPreviewCache.entries().next().value as [string, string] | undefined;
          if (oldest) {
            posterPreviewCache.delete(oldest[0]);
            URL.revokeObjectURL(oldest[1]);
          }
        }
        item.resolve(previewUrl);
      })
      .catch(item.reject)
      .finally(() => {
        pendingPosterPreviews.delete(item.url);
        activePosterPreviewLoads -= 1;
        runPosterPreviewQueue();
      });
  }
}

function loadPosterPreview(url: string) {
  const cached = posterPreviewCache.get(url);
  if (cached) return Promise.resolve(cached);
  const pending = pendingPosterPreviews.get(url);
  if (pending) return pending;

  let resolveRequest!: (value: string) => void;
  let rejectRequest!: (reason: unknown) => void;
  const request = new Promise<string>((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  pendingPosterPreviews.set(url, request);
  posterPreviewQueue.unshift({ url, resolve: resolveRequest, reject: rejectRequest });
  runPosterPreviewQueue();
  return request;
}

function normalizeVideoPath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function getVideoDedupeKey(video: VideoFile) {
  return normalizeVideoPath(video.path) || video.id;
}

function withFreshPoster(video: VideoFile): VideoFile {
  return {
    ...video,
    posterRevision: Date.now()
  };
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
  sortField: SortField;
  sortDirection: SortDirection;
  videoId: string | null;
};

type SortField = "name" | "date";
type SortDirection = "asc" | "desc";

const nameCollator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

function normalizeSortText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function compareNames(left: string, right: string) {
  return nameCollator.compare(normalizeSortText(left), normalizeSortText(right));
}

function compareDates(left: string, right: string, direction: SortDirection) {
  const leftTime = Date.parse(normalizeSortText(left));
  const rightTime = Date.parse(normalizeSortText(right));
  const hasLeftDate = Number.isFinite(leftTime);
  const hasRightDate = Number.isFinite(rightTime);

  if (!hasLeftDate && !hasRightDate) return 0;
  if (!hasLeftDate) return 1;
  if (!hasRightDate) return -1;
  return direction === "asc" ? leftTime - rightTime : rightTime - leftTime;
}

function compareVideos(left: VideoFile, right: VideoFile, field: SortField, direction: SortDirection) {
  const comparison = field === "date"
    ? compareDates(left.modifiedAt, right.modifiedAt, direction)
    : compareNames(left.title, right.title) * (direction === "asc" ? 1 : -1);
  return comparison || compareNames(left.title, right.title);
}

function getEntryName(entry: FileBrowserEntry) {
  if (entry.type === "folder") return entry.folder.name;
  if (entry.type === "file") return entry.file.name;
  return entry.video.title;
}

function getEntryDate(entry: FileBrowserEntry) {
  if (entry.type === "folder") return entry.folder.lastScanAt;
  if (entry.type === "file") return entry.file.modifiedAt;
  return entry.video.modifiedAt;
}

function compareFileEntries(
  left: FileBrowserEntry,
  right: FileBrowserEntry,
  field: SortField,
  direction: SortDirection
) {
  const leftIsFolder = left.type === "folder";
  const rightIsFolder = right.type === "folder";
  if (leftIsFolder !== rightIsFolder) {
    return leftIsFolder ? -1 : 1;
  }

  const comparison = field === "date"
    ? compareDates(getEntryDate(left), getEntryDate(right), direction)
    : compareNames(getEntryName(left), getEntryName(right)) * (direction === "asc" ? 1 : -1);
  return comparison || compareNames(getEntryName(left), getEntryName(right));
}

function readRouteState(): RouteState {
  const params = new URLSearchParams(window.location.search);
  const page = params.get("page");
  const view = params.get("view");
  const sortField: SortField = params.get("sort") === "date" ? "date" : "name";

  return {
    page: page === "files" || page === "player" || page === "admin" ? page : "videos",
    currentFolderId: params.get("folder"),
    selectedFolder: params.get("selected") || "all",
    query: params.get("q") || "",
    viewMode: view === "list" ? "list" : "tiles",
    sortField,
    sortDirection: params.has("order") ? (params.get("order") === "desc" ? "desc" : "asc") : (sortField === "date" ? "desc" : "asc"),
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
  const [sortField, setSortField] = useState<SortField>(initialRouteState.sortField);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialRouteState.sortDirection);
  useEffect(() => {
    const closeSortMenu = (event: PointerEvent | KeyboardEvent) => {
      const menu = document.querySelector<HTMLDetailsElement>(".sort-menu[open]");
      if (!menu) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        menu.open = false;
        menu.querySelector("summary")?.focus();
      } else if (event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    };
    document.addEventListener("pointerdown", closeSortMenu);
    document.addEventListener("keydown", closeSortMenu);
    return () => {
      document.removeEventListener("pointerdown", closeSortMenu);
      document.removeEventListener("keydown", closeSortMenu);
    };
  }, []);
  const [selectedVideo, setSelectedVideo] = useState<VideoFile | null>(null);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(initialRouteState.videoId);
  const [loadError, setLoadError] = useState("");
  const [session, setSession] = useState<AdminSession | null>(() => {
    const raw = localStorage.getItem(sessionStorageKey);
    try { return raw ? (JSON.parse(raw) as AdminSession) : null; } catch { return null; }
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
    const resetExpiredSession = () => {
      setSession(null);
    };

    window.addEventListener(authExpiredEvent, resetExpiredSession);
    return () => window.removeEventListener(authExpiredEvent, resetExpiredSession);
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData, session]);

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
    if (sortField !== "name") {
      params.set("sort", sortField);
    }
    if (sortDirection !== "asc") {
      params.set("order", sortDirection);
    }
    if (page === "player") {
      const videoId = selectedVideo?.id ?? activeVideoId;
      if (videoId) {
        params.set("video", videoId);
      }
    }

    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, [activeVideoId, currentFolderId, page, query, selectedFolder, selectedVideo, sortDirection, sortField, viewMode]);

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
          setLoadError("");
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
  }, [currentFolderId, folders, session]);

  const rootFolders = folders.filter((folder) => folder.isRoot);
  const isAdminSession = isAdministrator(session);
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
    }).sort((left, right) => compareVideos(left, right, sortField, sortDirection));
  }, [query, selectedFolder, sortDirection, sortField, videos, visibleRootFolders]);

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

              if (entry.type === "file") {
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
    const filteredEntries = normalizedQuery
      ? entries.filter((entry) => {
          if (entry.type === "folder") {
            return entry.folder.name.toLowerCase().includes(normalizedQuery);
          }

          if (entry.type === "file") {
            return [entry.file.name, entry.file.path, entry.file.mimeType]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery);
          }

          return [entry.video.title, entry.video.folderName, entry.video.codec, entry.video.resolution]
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery);
        })
      : entries;

    return [...filteredEntries].sort((left, right) => compareFileEntries(left, right, sortField, sortDirection));
  }, [currentFolderId, fileEntries, folders, query, sortDirection, sortField, videos]);

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

  const openAllVideos = () => {
    setSelectedFolder("all");
    setPage("videos");
    setSelectedVideo(null);
    setActiveVideoId(null);
    scrollToTop();
  };

  const handleLogin = (nextSession: AdminSession) => {
    localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
    setSession(nextSession);
  };

  const handleLogout = () => {
    localStorage.removeItem(sessionStorageKey);
    setSession(null);
  };

  const handleFolderCreated = ({ folder }: { folder: VaultFolder }) => {
    setFolders((current) => [folder, ...current]);
  };

  const handleFolderUpdated = (folder: VaultFolder) => {
    setFolders((current) => current.map((item) => (item.id === folder.id ? folder : item)));
  };

  const handleVideoUpdated = (video: VideoFile) => {
    const nextVideo = withFreshPoster(video);
    setVideos((current) => current.map((item) => (item.id === nextVideo.id ? nextVideo : item)));
    setFileEntries((current) =>
      current.map((entry) =>
        entry.type === "video" && entry.video.id === nextVideo.id ? { ...entry, video: nextVideo } : entry
      )
    );
    setSelectedVideo((current) => (current?.id === nextVideo.id ? nextVideo : current));
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
          <button className={selectedFolder === "all" ? "active" : ""} onClick={openAllVideos}>
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
          <AccountCenter session={session} onLogin={handleLogin} onLogout={handleLogout}><AdminPage
            folders={rootFolders}
            videos={videos}
            scrollContainerRef={contentRef}
            session={session}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onFolderCreated={handleFolderCreated}
            onFolderUpdated={handleFolderUpdated}
            onFolderDeleted={handleFolderDeleted}
            onVideoUpdated={handleVideoUpdated}
          /></AccountCenter>
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
                  placeholder={page === "files" ? "Поиск по папкам, видео и файлам" : "Поиск по названию, папке, кодеку"}
                />
              </label>

              <div className="toolbar-controls">
                <details className="sort-menu">
                  <summary>{sortField === "name" ? <ArrowDownAZ size={18} /> : <CalendarDays size={18} />}<span>{sortField === "name" ? "По имени" : "По дате"}</span><ChevronDown size={16} /></summary>
                  <div className="sort-options">
                  <button
                    className={sortField === "name" ? "selected" : ""}
                    onClick={(event) => {
                      setSortField("name");
                      setSortDirection("asc");
                      event.currentTarget.closest("details")?.removeAttribute("open");
                    }}
                    title="Сортировать по имени"
                  >
                    <ArrowDownAZ size={18} />
                    <span>Имя</span>
                    {sortField === "name" && <Check size={16} />}
                  </button>
                  <button
                    className={sortField === "date" ? "selected" : ""}
                    onClick={(event) => {
                      setSortField("date");
                      setSortDirection("desc");
                      event.currentTarget.closest("details")?.removeAttribute("open");
                    }}
                    title="Сортировать по дате"
                  >
                    <CalendarDays size={18} />
                    <span>Дата</span>
                    {sortField === "date" && <Check size={16} />}
                  </button>
                  </div>
                </details>

                <button
                  className="sort-direction"
                  onClick={() => setSortDirection((current) => current === "asc" ? "desc" : "asc")}
                  title={sortDirection === "asc" ? "По возрастанию" : "По убыванию"}
                  aria-label={sortDirection === "asc" ? "По возрастанию" : "По убыванию"}
                >
                  {sortDirection === "asc" ? <ArrowUp size={18} /> : <ArrowDown size={18} />}
                </button>

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
  const [previewFile, setPreviewFile] = useState<SharedFile | null>(null);
  const folderCount = entries.filter((entry) => entry.type === "folder").length;
  const videoCount = entries.filter((entry) => entry.type === "video").length;
  const fileCount = entries.filter((entry) => entry.type === "file").length;

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
        <span>{fileCount} файлов</span>
      </section>

      {entries.length === 0 ? (
        <section className="empty-folder">
          <FolderOpen size={34} />
          <h2>Папка пустая</h2>
          <p>Внутри нет вложенных папок и файлов.</p>
        </section>
      ) : (
        <section className={viewMode === "tiles" ? "file-grid" : "file-list"} aria-label="Все файлы">
          {entries.map((entry) =>
            entry.type === "folder" ? (
              <FolderItem key={entry.folder.id} folder={entry.folder} onOpen={() => onOpenFolder(entry.folder)} />
            ) : entry.type === "video" ? (
              <VideoItem key={entry.video.id} video={entry.video} mode={viewMode} onPlay={() => onOpenVideo(entry.video)} />
            ) : (
              <FileItem key={entry.file.id} file={entry.file} onPreview={() => setPreviewFile(entry.file)} />
            )
          )}
        </section>
      )}
      {previewFile && <ImageViewer file={previewFile} onClose={() => setPreviewFile(null)} />}
    </>
  );
}

function isImageFile(file: SharedFile) {
  if (file.mimeType.toLowerCase().startsWith("image/")) {
    return true;
  }

  return /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(file.name);
}

function getFileExtension(fileName: string) {
  const name = fileName.split(/[\\/]/).pop() ?? fileName;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return "ФАЙЛ";
  }

  return name.slice(dotIndex + 1).toUpperCase();
}

function FileItem({ file, onPreview }: { file: SharedFile; onPreview: () => void }) {
  const image = isImageFile(file);
  const extension = getFileExtension(file.name);
  const fileUrl = getFileDownloadUrl(file.id);
  const content = (
    <>
      <span className={image ? "file-preview image" : "file-preview"}>
        {image ? <img src={fileUrl} alt="" loading="lazy" /> : <FileIcon size={34} />}
      </span>
      <span className="file-copy">
        <strong>{file.name}</strong>
        <span className="file-meta">
          <b>{extension}</b>
          {file.size && <small>{file.size}</small>}
        </span>
      </span>
      <span className="file-action-icon" aria-hidden="true">
        {image ? <ImageIcon size={18} /> : <Download size={18} />}
      </span>
    </>
  );

  return (
    <article className="shared-file-card">
      {image ? (
        <button className="shared-file-open" onClick={onPreview} aria-label={`Открыть изображение ${file.name}`}>
          {content}
        </button>
      ) : (
        <a className="shared-file-open" href={fileUrl} download={file.name} aria-label={`Скачать ${file.name}`}>
          {content}
        </a>
      )}
    </article>
  );
}

function ImageViewer({ file, onClose }: { file: SharedFile; onClose: () => void }) {
  const fileUrl = getFileDownloadUrl(file.id);
  const extension = getFileExtension(file.name);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop image-viewer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <section className="image-viewer" role="dialog" aria-modal="true" aria-label={`Просмотр ${file.name}`}>
        <header className="image-viewer-header">
          <div>
            <strong>{file.name}</strong>
            <span>{extension}{file.size ? ` · ${file.size}` : ""} · {file.path}</span>
          </div>
          <div className="image-viewer-actions">
            <a className="icon-button" href={fileUrl} download={file.name} title="Скачать">
              <Download size={18} />
            </a>
            <button className="icon-button" onClick={onClose} title="Закрыть">
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="image-viewer-stage">
          <img src={fileUrl} alt={file.name} />
        </div>
      </section>
    </div>
  );
}

function FolderItem({ folder, onOpen }: { folder: VaultFolder; onOpen: () => void }) {
  const isEmpty = folder.videoCount === 0 && folder.childFolderCount === 0;

  return (
    <article className="folder-card folder-card-refined">
      <button className="folder-open-button" onClick={onOpen} aria-label={`Открыть папку ${folder.name}`}>
        <span className="folder-icon" aria-hidden="true">
          <Folder size={30} strokeWidth={1.5} fill="currentColor" />
        </span>
        <span className="folder-copy">
          <strong>{folder.name}</strong>
          <span className="folder-card-meta">
            {isEmpty ? <span>Пустая папка</span> : <>
              <span><Folder size={13} aria-hidden="true" />{folder.childFolderCount}<span className="visually-hidden"> папок</span></span>
              <span><FileVideo size={13} aria-hidden="true" />{folder.videoCount}<span className="visually-hidden"> видео</span></span>
            </>}
          </span>
        </span>
        <ChevronRight className="folder-chevron" size={18} aria-hidden="true" />
      </button>
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

function PosterImage({ video }: { video: VideoFile }) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [loadedPoster, setLoadedPoster] = useState<{ requestUrl: string; previewUrl: string } | null>(null);
  const posterUrl = getVideoPosterUrl(video.id, video.posterRevision);
  const posterUnavailable = failedUrl === posterUrl;

  useEffect(() => {
    if (shouldLoad) return;
    const container = containerRef.current;
    if (!container || !("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "120px 0px" }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    if (!shouldLoad) return;
    let cancelled = false;
    void loadPosterPreview(posterUrl)
      .then((previewUrl) => {
        if (!cancelled) setLoadedPoster({ requestUrl: posterUrl, previewUrl });
      })
      .catch(() => {
        if (!cancelled) setFailedUrl(posterUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [posterUrl, shouldLoad]);

  if (posterUnavailable) {
    return (
      <span ref={containerRef} className="poster-thumbnail poster-placeholder" aria-hidden="true">
        <FileVideo size={30} />
      </span>
    );
  }

  if (!shouldLoad || loadedPoster?.requestUrl !== posterUrl) {
    return <span ref={containerRef} className="poster-thumbnail poster-skeleton" aria-hidden="true" />;
  }

  return (
    <img
      className="poster-thumbnail"
      src={loadedPoster.previewUrl}
      alt=""
      width={320}
      height={180}
      loading="lazy"
      decoding="async"
      fetchPriority="low"
      onError={() => setFailedUrl(posterUrl)}
    />
  );
}

function VideoItem({ video, mode, onPlay }: { video: VideoFile; mode: ViewMode; onPlay: () => void }) {
  const duration = formatDuration(video.duration);

  return (
    <article className="video-item">
      <button className="poster-button" onClick={onPlay} aria-label={`Открыть ${video.title}`}>
        <PosterImage video={video} />
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
            <dt className="visually-hidden">Размер</dt>
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
  const mediaRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [error, setError] = useState("");
  const [speed, setSpeed] = useState(1);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isLandscape, setIsLandscape] = useState(() => window.matchMedia("(orientation: landscape)").matches);
  const [forcedLandscape, setForcedLandscape] = useState(false);
  const [isAppFullscreen, setIsAppFullscreen] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [tapFeedback, setTapFeedback] = useState<"left" | "right" | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ time: number; side: "left" | "right" } | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const ignoreTouchClick = useRef(false);
  const lastPointerWasTouch = useRef(false);
  const revealControls = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  };
  const toggleTouchControls = () => {
    setControlsVisible((current) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (current) return false;
      hideTimer.current = setTimeout(() => setControlsVisible(false), 3000);
      return true;
    });
  };
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);
  useEffect(() => {
    if (!isAppFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isAppFullscreen]);
  useEffect(() => {
    const orientationQuery = window.matchMedia("(orientation: landscape)");
    const updateOrientation = () => {
      if (!forcedLandscape) setIsLandscape(orientationQuery.matches);
    };
    orientationQuery.addEventListener("change", updateOrientation);
    return () => orientationQuery.removeEventListener("change", updateOrientation);
  }, [forcedLandscape]);
  useEffect(() => {
    const resetOrientation = () => {
      const fullscreenActive = Boolean(document.fullscreenElement);
      setIsNativeFullscreen(fullscreenActive);
      if (fullscreenActive) return;
      setIsAppFullscreen(false);
      setForcedLandscape(false);
      setIsLandscape(window.matchMedia("(orientation: landscape)").matches);
      const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
      orientation?.unlock?.();
    };
    document.addEventListener("fullscreenchange", resetOrientation);
    return () => document.removeEventListener("fullscreenchange", resetOrientation);
  }, []);
  useEffect(() => {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: video.title,
        album: video.folderName,
        artwork: video.posterUrl ? [{ src: video.posterUrl }] : []
      });
    } catch {
      navigator.mediaSession.metadata = null;
    }

    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => { void mediaRef.current?.play(); },
      pause: () => mediaRef.current?.pause(),
      seekbackward: (details) => seek(-(details.seekOffset ?? 5)),
      seekforward: (details) => seek(details.seekOffset ?? 5)
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler ?? null);
      } catch {
        // Some mobile browsers expose Media Session but support only part of its actions.
      }
    }

    return () => {
      navigator.mediaSession.metadata = null;
      for (const action of ["play", "pause", "seekbackward", "seekforward"] as MediaSessionAction[]) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore actions unsupported by the current browser.
        }
      }
    };
  }, [video]);
  const clock = (seconds: number) => {
    const value = Math.floor(Number.isFinite(seconds) ? seconds : 0);
    return `${value >= 3600 ? `${Math.floor(value / 3600)}:` : ""}${String(Math.floor(value / 60) % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  };
  const fullscreen = async () => {
    revealControls();

    if (document.fullscreenElement) {
      const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
      orientation?.unlock?.();
      setForcedLandscape(false);
      setIsAppFullscreen(false);
      await document.exitFullscreen().catch(() => undefined);
      return;
    }

    if (isAppFullscreen) {
      setIsAppFullscreen(false);
      setForcedLandscape(false);
      setIsLandscape(window.matchMedia("(orientation: landscape)").matches);
      return;
    }

    const media = mediaRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    try {
      if (stageRef.current?.requestFullscreen) {
        await stageRef.current.requestFullscreen({ navigationUI: "hide" });
        return;
      }
      if (media?.webkitEnterFullscreen) {
        media.webkitEnterFullscreen();
        return;
      }
    } catch {
      // Fall through to the in-page fullscreen mode when the browser rejects fullscreen.
    }

    setIsAppFullscreen(true);
  };
  const changeOrientation = async () => {
    const nextLandscape = !(forcedLandscape || isLandscape);
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (value: "landscape" | "portrait") => Promise<void>;
      unlock?: () => void;
    };

    setError("");
    if (!nextLandscape) {
      setForcedLandscape(false);
      setIsLandscape(false);
      try {
        if (!document.fullscreenElement && stageRef.current?.requestFullscreen) {
          await stageRef.current.requestFullscreen({ navigationUI: "hide" });
        }
        if (orientation?.lock) {
          await orientation.lock("portrait");
        } else {
          orientation?.unlock?.();
          if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
        }
      } catch {
        orientation?.unlock?.();
        if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      }
      return;
    }

    try {
      if (!document.fullscreenElement && stageRef.current?.requestFullscreen) {
        await stageRef.current.requestFullscreen();
      }
      if (!orientation?.lock) throw new Error("Orientation lock is unavailable");
      await orientation.lock("landscape");
      setForcedLandscape(false);
      setIsLandscape(true);
    } catch {
      setForcedLandscape(true);
      setIsLandscape(true);
      if (!document.fullscreenElement) setIsAppFullscreen(true);
    }
  };
  const togglePlayback = () => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => {
      setWaiting(false);
      setPlaying(false);
      setError("");
    });
    else media.pause();
  };
  function seek(seconds: number) {
    const media = mediaRef.current;
    if (media && Number.isFinite(media.duration)) media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + seconds));
  }
  const showTapFeedback = (side: "left" | "right") => {
    setTapFeedback(side);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setTapFeedback(null), 550);
  };
  const handleVideoPointerUp = (event: { pointerType: string; clientX: number; clientY: number; currentTarget: HTMLVideoElement }) => {
    lastPointerWasTouch.current = event.pointerType === "touch";
    if (!lastPointerWasTouch.current) return;

    ignoreTouchClick.current = true;
    const start = touchStart.current;
    touchStart.current = null;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 18) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const side: "left" | "right" = event.clientX < bounds.left + bounds.width / 2 ? "left" : "right";
    const now = Date.now();
    const previous = lastTap.current;

    if (previous && previous.side === side && now - previous.time <= 320) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = null;
      lastTap.current = null;
      seek(side === "left" ? -5 : 5);
      showTapFeedback(side);
      revealControls();
      return;
    }

    if (tapTimer.current) clearTimeout(tapTimer.current);
    lastTap.current = { time: now, side };
    tapTimer.current = setTimeout(() => {
      lastTap.current = null;
      toggleTouchControls();
    }, 320);
  };

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

      <section className={`player-surface custom-player ${controlsVisible || !playing || waiting || error ? "controls-visible" : ""} ${forcedLandscape ? "forced-landscape" : ""} ${isAppFullscreen ? "app-fullscreen" : ""}`} ref={stageRef}
        tabIndex={0} aria-label="Видеоплеер" onPointerMove={revealControls} onFocus={revealControls}
        onKeyDown={(event) => {
          if (event.key === "Escape" && isAppFullscreen) {
            event.preventDefault();
            setIsAppFullscreen(false);
            setForcedLandscape(false);
            return;
          }
          if (event.target !== event.currentTarget && event.target !== mediaRef.current) return;
          if ([" ", "k", "ArrowLeft", "ArrowRight", "f", "m"].includes(event.key)) event.preventDefault();
          if (event.key === " " || event.key === "k") togglePlayback();
          if (event.key === "ArrowLeft") seek(-10);
          if (event.key === "ArrowRight") seek(10);
          if (event.key === "f") void fullscreen();
          if (event.key === "m" && mediaRef.current) mediaRef.current.muted = !mediaRef.current.muted;
          revealControls();
        }}>
        <div className="video-stage">
          <video ref={mediaRef}
          autoPlay
          playsInline
          preload="metadata"
          poster={getVideoPosterUrl(video.id, video.posterRevision)} src={video.streamUrl}
            onPointerDown={(event) => {
              lastPointerWasTouch.current = event.pointerType === "touch";
              if (lastPointerWasTouch.current) touchStart.current = { x: event.clientX, y: event.clientY };
              else ignoreTouchClick.current = false;
            }}
            onPointerUp={handleVideoPointerUp}
            onPointerCancel={() => { touchStart.current = null; ignoreTouchClick.current = false; }}
            onClick={() => {
              if (ignoreTouchClick.current) {
                ignoreTouchClick.current = false;
                return;
              }
              togglePlayback();
              revealControls();
            }}
            onDoubleClick={() => { if (!lastPointerWasTouch.current) void fullscreen(); }}
            onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
            onDurationChange={event => setLength(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onProgress={event => { const ranges = event.currentTarget.buffered; setBuffered(ranges.length ? ranges.end(ranges.length - 1) : 0); }}
            onVolumeChange={event => { setVolume(event.currentTarget.volume); setMuted(event.currentTarget.muted); }}
            onPlay={() => { setPlaying(true); setError(""); revealControls(); }} onPause={() => setPlaying(false)}
            onWaiting={() => setWaiting(true)} onPlaying={() => setWaiting(false)}
            onCanPlay={() => setWaiting(false)} onEnded={() => setPlaying(false)}
            onError={() => { setWaiting(false); setError("Не удалось открыть видео. Проверьте доступность файла и поддерживаемый формат."); }} />
          {waiting && !error && <div className="player-loading" role="status"><RefreshCw className="spin" size={22} /><span>Загрузка видео</span></div>}
          {!waiting && !error && (controlsVisible || !playing) && (
            <button className="center-play" onClick={() => { togglePlayback(); revealControls(); }} aria-label={playing ? "Пауза" : "Воспроизвести"}>
              {playing ? <Pause size={34} fill="currentColor" /> : <Play size={38} fill="currentColor" />}
            </button>
          )}
          {tapFeedback && (
            <div className={`tap-seek-feedback ${tapFeedback}`} aria-live="polite">
              {tapFeedback === "left" ? <RotateCcw size={28} /> : <RotateCw size={28} />}
              <span>{tapFeedback === "left" ? "−5" : "+5"}</span>
            </div>
          )}
          <button
            className="orientation-toggle"
            onClick={(event) => { event.stopPropagation(); void changeOrientation(); }}
            title={forcedLandscape || isLandscape ? "Вертикальная ориентация" : "Горизонтальная ориентация"}
            aria-label={forcedLandscape || isLandscape ? "Переключить в вертикальную ориентацию" : "Переключить в горизонтальную ориентацию"}
          >
            {forcedLandscape || isLandscape ? <Smartphone size={20} /> : <Monitor size={20} />}
          </button>
        </div>
        <div className="player-overlay">
        <input className="player-timeline" type="range" min={0} max={length || 1} step={0.1} value={Math.min(position, length)} disabled={!length} aria-label="Позиция воспроизведения" aria-valuetext={`${clock(position)} из ${clock(length)}`}
          style={{ background: `linear-gradient(to right, #d6ff6f ${length ? position / length * 100 : 0}%, #ffffff70 ${length ? position / length * 100 : 0}%, #ffffff70 ${length ? buffered / length * 100 : 0}%, #ffffff30 ${length ? buffered / length * 100 : 0}%)` }}
          onChange={event => { const value = Number(event.target.value); if (mediaRef.current) mediaRef.current.currentTime = value; setPosition(value); revealControls(); }} />
        <div className="playback-tools">
          <button className="seek-control" onClick={() => seek(-10)} title="Назад на 10 секунд" aria-label="Назад на 10 секунд"><RotateCcw size={20} /><small>10</small></button>
          <button className="playback-primary" onClick={togglePlayback} title={playing ? "Пауза" : "Воспроизвести"} aria-label={playing ? "Пауза" : "Воспроизвести"}>{playing ? <Pause size={22} /> : <Play size={22} />}</button>
          <button className="seek-control" onClick={() => seek(10)} title="Вперёд на 10 секунд" aria-label="Вперёд на 10 секунд"><RotateCw size={20} /><small>10</small></button>
          <button className="player-mute-button" onClick={() => { if (mediaRef.current) mediaRef.current.muted = !muted; }} title={muted ? "Включить звук" : "Выключить звук"} aria-label={muted ? "Включить звук" : "Выключить звук"}>{muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}</button>
          <input className="player-volume" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Громкость" onChange={event => { if (mediaRef.current) { mediaRef.current.volume = Number(event.target.value); mediaRef.current.muted = false; } }} />
          <span className="player-clock">{clock(position)} / {clock(length)}</span>
          <details className="player-speed-menu" onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.removeAttribute("open");
          }}>
            <summary aria-label={`Скорость воспроизведения ${speed}×`}>{speed}×</summary>
            <div className="player-speed-options">
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
                <button key={value} className={speed === value ? "selected" : ""} onClick={(event) => {
                  setSpeed(value);
                  if (mediaRef.current) mediaRef.current.playbackRate = value;
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}>
                  <span>{value}×</span>
                  {speed === value && <Check size={15} />}
                </button>
              ))}
            </div>
          </details>
          <button title={isAppFullscreen || isNativeFullscreen ? "Выйти из полноэкранного режима" : "Полный экран"} aria-label={isAppFullscreen || isNativeFullscreen ? "Выйти из полноэкранного режима" : "Полный экран"} onClick={() => { void fullscreen(); }}>
            {isAppFullscreen || isNativeFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        </div>
        </div>
        {error && <p className="player-message" role="alert">{error}</p>}
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
  videos,
  scrollContainerRef,
  session,
  onLogin,
  onLogout,
  onFolderCreated,
  onFolderUpdated,
  onFolderDeleted,
  onVideoUpdated
}: {
  folders: VaultFolder[];
  videos: VideoFile[];
  scrollContainerRef: RefObject<HTMLElement | null>;
  session: AdminSession | null;
  onLogin: (session: AdminSession) => void;
  onLogout: () => void;
  onFolderCreated: (payload: { folder: VaultFolder }) => void;
  onFolderUpdated: (folder: VaultFolder) => void;
  onFolderDeleted: (folderId: string) => Promise<void>;
  onVideoUpdated: (video: VideoFile) => void;
}) {
  const [login, setLogin] = useState("admin");
  const [password, setPassword] = useState("");
  const [accountStatus, setAccountStatus] = useState<InactiveAccountStatus | null>(null);
  const [path, setPath] = useState("D:\\Video");
  const [error, setError] = useState("");
  const [isBusy, setBusy] = useState(false);
  const [isPickerOpen, setPickerOpen] = useState(false);
  const [rescanningFolderId, setRescanningFolderId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [updatingFolderId, setUpdatingFolderId] = useState<string | null>(null);
  const [posterQuery, setPosterQuery] = useState("");
  const [posterFolderId, setPosterFolderId] = useState("all");
  const [updatingPosterId, setUpdatingPosterId] = useState<string | null>(null);

  const posterFolders = useMemo(() => {
    const counts = new Map<string, number>();
    videos.forEach((video) => counts.set(video.folderId, (counts.get(video.folderId) ?? 0) + 1));
    return folders
      .map((folder) => ({ id: folder.id, name: folder.name, count: counts.get(folder.id) ?? 0 }))
      .filter((folder) => folder.count > 0)
      .sort((left, right) => left.name.localeCompare(right.name, "ru", { numeric: true }));
  }, [folders, videos]);

  const filteredPosterVideos = useMemo(() => {
    const normalizedQuery = posterQuery.trim().toLocaleLowerCase();
    return videos.filter((video) => {
      const matchesFolder = posterFolderId === "all" || video.folderId === posterFolderId;
      const matchesQuery = !normalizedQuery ||
        [video.title, video.path, video.folderName].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
      return matchesFolder && matchesQuery;
    });
  }, [posterFolderId, posterQuery, videos]);

  useEffect(() => {
    if (posterFolderId === "all" || posterFolders.some((folder) => folder.id === posterFolderId)) return;
    setPosterFolderId("all");
  }, [posterFolderId, posterFolders]);

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setAccountStatus(null);

    try {
      onLogin(await loginAdmin(login, password));
    } catch (nextError) {
      const nextStatus = getInactiveAccountStatus(nextError);
      if (nextStatus) {
        setAccountStatus(nextStatus);
      } else {
        setError(nextError instanceof Error ? nextError.message : "Ошибка входа.");
      }
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

  const changePoster = async (video: VideoFile, file: File) => {
    const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!supportedTypes.has(file.type)) {
      setError("Для постера выберите изображение JPEG, PNG или WebP.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Размер постера не должен превышать 10 МБ.");
      return;
    }

    setUpdatingPosterId(video.id);
    setError("");
    try {
      onVideoUpdated(await updateVideoPoster(video.id, file));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось сменить постер.");
    } finally {
      setUpdatingPosterId(null);
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
            <input value={login} onChange={(event) => { setLogin(event.target.value); setAccountStatus(null); }} autoComplete="username" />
          </label>
          <label>
            Пароль
            <input
              value={password}
              onChange={(event) => { setPassword(event.target.value); setAccountStatus(null); }}
              type="password"
              autoComplete="current-password"
            />
          </label>
          {error && <p className="error">{error}</p>}
          {accountStatus && <AccountAuthStatus status={accountStatus} />}
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

          <section className="poster-manager admin-page-card">
            <header className="poster-manager-header">
              <div>
                <h2>Постеры видео</h2>
                <span>{videos.length} видео</span>
              </div>
              <label className="admin-video-search">
                <Search size={18} />
                <input
                  value={posterQuery}
                  onChange={(event) => setPosterQuery(event.target.value)}
                  placeholder="Найти видео"
                />
              </label>
            </header>

            <nav className="poster-folder-strip" aria-label="Фильтр видео по папкам">
              <button
                type="button"
                className={posterFolderId === "all" ? "selected" : ""}
                aria-pressed={posterFolderId === "all"}
                onClick={() => setPosterFolderId("all")}
              >
                <span>Все видео</span>
                <b>{videos.length}</b>
              </button>
              {posterFolders.map((folder) => (
                <button
                  type="button"
                  key={folder.id}
                  className={posterFolderId === folder.id ? "selected" : ""}
                  aria-pressed={posterFolderId === folder.id}
                  onClick={() => setPosterFolderId(folder.id)}
                  title={folder.name}
                >
                  <span>{folder.name}</span>
                  <b>{folder.count}</b>
                </button>
              ))}
            </nav>

            <VirtualPosterGrid
              videos={filteredPosterVideos}
              scrollContainerRef={scrollContainerRef}
              updatingPosterId={updatingPosterId}
              disabled={updatingPosterId !== null}
              onChange={changePoster}
            />
          </section>
        </section>
      )}
    </>
  );
}

function VirtualPosterGrid({
  videos,
  scrollContainerRef,
  updatingPosterId,
  disabled,
  onChange
}: {
  videos: VideoFile[];
  scrollContainerRef: RefObject<HTMLElement | null>;
  updatingPosterId: string | null;
  disabled: boolean;
  onChange: (video: VideoFile, file: File) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [metrics, setMetrics] = useState({ width: 0, scrollTop: 0, viewportHeight: 800, gridTop: 0 });

  const measure = useCallback(() => {
    const grid = gridRef.current;
    const scroller = scrollContainerRef.current;
    if (!grid || !scroller) return;
    const gridRect = grid.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const next = {
      width: grid.clientWidth,
      scrollTop: scroller.scrollTop,
      viewportHeight: scroller.clientHeight,
      gridTop: gridRect.top - scrollerRect.top + scroller.scrollTop
    };
    setMetrics((current) =>
      current.width === next.width &&
      current.scrollTop === next.scrollTop &&
      current.viewportHeight === next.viewportHeight &&
      Math.abs(current.gridTop - next.gridTop) < 1
        ? current
        : next
    );
  }, [scrollContainerRef]);

  useEffect(() => {
    const grid = gridRef.current;
    const scroller = scrollContainerRef.current;
    if (!grid || !scroller) return;
    const scheduleMeasure = () => {
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = null;
        measure();
      });
    };
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(grid);
    resizeObserver.observe(scroller);
    scroller.addEventListener("scroll", scheduleMeasure, { passive: true });
    measure();
    return () => {
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", scheduleMeasure);
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [measure, scrollContainerRef, videos.length]);

  if (videos.length === 0) {
    return <p className="poster-list-empty">Видео не найдены.</p>;
  }

  const mobile = metrics.width <= 560;
  const gap = mobile ? 8 : 14;
  const minimumColumnWidth = mobile ? 166 : 280;
  const columns = Math.max(1, Math.floor((metrics.width + gap) / (minimumColumnWidth + gap)));
  const columnWidth = columns > 0 ? (metrics.width - gap * (columns - 1)) / columns : metrics.width;
  const cardHeight = columnWidth * 9 / 16 + (mobile ? 56 : 60);
  const rowHeight = cardHeight + gap;
  const rowCount = Math.ceil(videos.length / columns);
  const localScrollTop = Math.max(0, metrics.scrollTop - metrics.gridTop);
  const firstRow = Math.max(0, Math.floor(localScrollTop / rowHeight) - 2);
  const lastRow = Math.min(rowCount, Math.ceil((localScrollTop + metrics.viewportHeight) / rowHeight) + 3);
  const firstIndex = firstRow * columns;
  const lastIndex = Math.min(videos.length, lastRow * columns);
  const totalHeight = Math.max(0, rowCount * rowHeight - gap);

  return (
    <div ref={gridRef} className="poster-virtual-grid" style={{ height: totalHeight }}>
      {videos.slice(firstIndex, lastIndex).map((video, sliceIndex) => {
        const index = firstIndex + sliceIndex;
        const row = Math.floor(index / columns);
        const column = index % columns;
        return (
          <div
            className="poster-virtual-cell"
            key={video.id}
            style={{
              width: columnWidth,
              height: cardHeight,
              transform: `translate3d(${column * (columnWidth + gap)}px, ${row * rowHeight}px, 0)`
            }}
          >
            <AdminPosterRow
              video={video}
              isUpdating={updatingPosterId === video.id}
              disabled={disabled}
              onChange={(file) => onChange(video, file)}
            />
          </div>
        );
      })}
    </div>
  );
}

function AdminPosterRow({
  video,
  isUpdating,
  disabled,
  onChange
}: {
  video: VideoFile;
  isUpdating: boolean;
  disabled: boolean;
  onChange: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <article className="poster-video-card">
      <button
        type="button"
        className="poster-preview-button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        title={isUpdating ? "Загрузка постера" : "Сменить постер"}
        aria-label={isUpdating ? `Загрузка постера ${video.title}` : `Сменить постер ${video.title}`}
      >
        <PosterImage video={video} />
        <span className="poster-edit-action">
          {isUpdating ? <RefreshCw className="spin" size={18} /> : <ImagePlus size={18} />}
          <span>{isUpdating ? "Загрузка" : "Сменить"}</span>
        </span>
      </button>
      <div className="poster-video-copy">
        <strong>{video.title}</strong>
        <span title={video.path}>{video.folderName}</span>
      </div>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            onChange(file);
          }
        }}
      />
    </article>
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

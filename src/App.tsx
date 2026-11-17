import { VideoProblemBadge, VideoProblemControl } from "./VideoProblem";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { useConfirmation } from "./Confirmation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Checkbox } from "./components/ui/checkbox";
import { Switch } from "./components/ui/switch";
import { NativeSelect, NativeSelectOption } from "./components/ui/native-select";
import { Badge } from "./components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "./components/ui/dropdown-menu";
import { ImageLightbox } from "./ImageLightbox";
import { PlayerAmbient } from "./PlayerAmbient";
import { PlayerPlaylist } from "./PlayerPlaylist";
import { createHoldToSpeed } from "./lib/hold-to-speed";
import type { attachHls, PlaybackAudioTrack } from "./hlsPlayback";
import { Wallpaper, type WallpaperVariant } from "./Wallpaper";
import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject, type ReactNode, type CSSProperties } from "react";
import { AccountAuthStatus, AccountCenter, AuthForm, PasswordForm, isAdministrator } from "./Accounts";
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
  SkipBack,
  SkipForward,
  RefreshCw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Shield,
  Smartphone,
  Monitor,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import {
  addFolder,
  authExpiredEvent,
  browseServerFolders,
  deleteFolder,
  deleteMediaFile,
  deleteMediaVideo,
  getFolderEntries,
  getFileDownloadUrl,
  getFolders,
  getHlsMasterUrl,
  getInactiveAccountStatus,
  getVideo,
  getVideoAudioTracks,
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
const posterPreviewUsers = new Map<string, number>();

// Keep mounted cards' URLs alive, even while the player hides the library.
function trimPosterPreviewCache() {
  let unused = [...posterPreviewCache.keys()].filter((url) => !posterPreviewUsers.has(url)).length;
  for (const [url, preview] of posterPreviewCache) {
    if (unused <= 96) break;
    if (posterPreviewUsers.has(url)) continue;
    posterPreviewCache.delete(url);
    URL.revokeObjectURL(preview);
    unused -= 1;
  }
}
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
        trimPosterPreviewCache();
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
  if (cached) {
    posterPreviewCache.delete(url);
    posterPreviewCache.set(url, cached);
    return Promise.resolve(cached);
  }
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
  fileTypeFilter: FileTypeFilter;
  videoId: string | null;
};

type SortField = "name" | "date";
type SortDirection = "asc" | "desc";
type FileTypeFilter = "videos" | "files" | "images" | "all";

const fileTypeLabels: Record<FileTypeFilter, string> = {
  videos: "Видео",
  files: "Файлы",
  images: "Изображения",
  all: "Все типы"
};

function FileTypeIcon({ type, size = 18 }: { type: FileTypeFilter; size?: number }) {
  if (type === "videos") return <FileVideo size={size} />;
  if (type === "images") return <ImageIcon size={size} />;
  if (type === "files") return <FileIcon size={size} />;
  return <HardDrive size={size} />;
}

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
  const requestedFileType = params.get("type");
  const fileTypeFilter: FileTypeFilter = requestedFileType === "files"
    || requestedFileType === "images"
    || requestedFileType === "all"
    ? requestedFileType
    : "videos";

  return {
    page: page === "files" || page === "player" || page === "admin" || page === "settings" || page === "login" ? page : "videos",
    currentFolderId: params.get("folder"),
    selectedFolder: params.get("selected") || "all",
    query: params.get("q") || "",
    viewMode: view === "list" ? "list" : "tiles",
    sortField,
    sortDirection: params.has("order") ? (params.get("order") === "desc" ? "desc" : "asc") : (sortField === "date" ? "desc" : "asc"),
    fileTypeFilter,
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
  const [showBackToTop, setShowBackToTop] = useState(false);
  useEffect(() => {
    const content = contentRef.current;
    const mobile = window.matchMedia("(max-width: 860px)");
    const update = () => setShowBackToTop((mobile.matches ? window.scrollY : content?.scrollTop ?? 0) > 360);
    content?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
    return () => {
      content?.removeEventListener("scroll", update);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [page]);
  const [theme, setTheme] = useState<"classic" | "glass">(() => {
    try { return localStorage.getItem("vault-theme") === "glass" ? "glass" : "classic"; }
    catch { return "classic"; }
  });
  useEffect(() => {
    try { localStorage.setItem("vault-theme", theme); } catch { /* Keep the selection for this session. */ }
  }, [theme]);
  const [wallpaper, setWallpaper] = useState<WallpaperVariant>(() => {
    try {
      const saved = localStorage.getItem("vault-wallpaper");
      return saved === "dark" || saved === "water" || saved === "rostislav" || saved === "good-bad" || saved === "slime" ? saved : "hunt";
    } catch { return "hunt"; }
  });

  useEffect(() => {
    try { localStorage.setItem("vault-wallpaper", wallpaper); } catch { /* Keep the selection for this session. */ }
  }, [wallpaper]);
  const [selectedFolder, setSelectedFolder] = useState(initialRouteState.selectedFolder);
  const [query, setQuery] = useState(initialRouteState.query);
  const [viewMode, setViewMode] = useState<ViewMode>(initialRouteState.viewMode);
  const [sortField, setSortField] = useState<SortField>(initialRouteState.sortField);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialRouteState.sortDirection);
  const [fileTypeFilter, setFileTypeFilter] = useState<FileTypeFilter>(initialRouteState.fileTypeFilter);
  useEffect(() => {
    const closeSortMenu = (event: PointerEvent | KeyboardEvent) => {
      const menus = document.querySelectorAll<HTMLDetailsElement>(".sort-menu[open]");
      if (menus.length === 0) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        menus.forEach((menu, index) => {
          menu.open = false;
          if (index === 0) menu.querySelector("summary")?.focus();
        });
      } else if (event.target instanceof Node) {
        menus.forEach((menu) => {
          if (!menu.contains(event.target as Node)) menu.open = false;
        });
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
  const [playerQueue, setPlayerQueue] = useState<VideoFile[]>([]);
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
    if (page === "files" && fileTypeFilter !== "videos") {
      params.set("type", fileTypeFilter);
    }
    if (page === "player") {
      const videoId = selectedVideo?.id ?? activeVideoId;
      if (videoId) {
        params.set("video", videoId);
      }
    }

    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, [activeVideoId, currentFolderId, fileTypeFilter, page, query, selectedFolder, selectedVideo, sortDirection, sortField, viewMode]);

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
    const queryFilteredEntries = normalizedQuery
      ? entries.filter((entry) => {
          if (entry.type === "folder") {
            return entry.folder.name.toLowerCase().includes(normalizedQuery);
          }

          if (entry.type === "file") {
            return [
              entry.file.name,
              entry.file.path,
              entry.file.folderName,
              entry.file.extension,
              entry.file.mimeType ?? ""
            ]
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

    const filteredEntries = queryFilteredEntries.filter((entry) => {
      if (entry.type === "folder" || fileTypeFilter === "all") return true;
      if (fileTypeFilter === "videos") return entry.type === "video";
      if (entry.type !== "file") return false;
      return fileTypeFilter === "images" ? isImageFile(entry.file) : !isImageFile(entry.file);
    });

    return [...filteredEntries].sort((left, right) => compareFileEntries(left, right, sortField, sortDirection));
  }, [currentFolderId, fileEntries, fileTypeFilter, folders, query, sortDirection, sortField, videos]);

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

  useLayoutEffect(() => {
    if (page === "player" || pendingScrollRestoreRef.current === null) {
      return;
    }

    const nextScrollTop = pendingScrollRestoreRef.current;
    pendingScrollRestoreRef.current = null;

    // Restore before paint, without flashing the first row or loading its posters.
    restoreScrollPosition(nextScrollTop);
  }, [filteredVideos.length, page, visibleFileEntries.length]);

  const openPage = (nextPage: Page) => {
    setPage(nextPage === "admin" && !session ? "login" : nextPage);
    setSelectedVideo(null);
    if (nextPage !== "player") {
      setActiveVideoId(null);
    }
    scrollToTop();
  };

  const openPlayer = (video: VideoFile) => {
    if (page !== "player") {
      playerReturnPageRef.current = page;
      returnScrollTopRef.current = getCurrentScrollTop();
      const queue = page === "files"
        ? visibleFileEntries.flatMap(entry => entry.type === "video" ? [entry.video] : [])
        : filteredVideos;
      setPlayerQueue(queue.some(item => item.id === video.id) ? queue : [video, ...queue]);
    }
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
    openPage("settings");
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

  const handleVideoDeleted = (videoId: string) => {
    setVideos((current) => current.filter((video) => video.id !== videoId));
    setFileEntries((current) => current.filter((entry) => entry.type !== "video" || entry.video.id !== videoId));
    setSelectedVideo((current) => (current?.id === videoId ? null : current));
    setActiveVideoId((current) => (current === videoId ? null : current));
  };

  const handleFileDeleted = (fileId: string) => {
    setFileEntries((current) => current.filter((entry) => entry.type !== "file" || entry.file.id !== fileId));
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

  const browsePage = page === "player" ? playerReturnPageRef.current : page;
  const pageTitle = browsePage === "files" ? "Все файлы" : "Видеотека";
  const pageEyebrow = browsePage === "files" ? "Проводник" : "VIDEO VAULT / AFTER DARK";
  const playerPlaylist = useMemo(() => {
    const queue = playerQueue.length ? playerQueue : filteredVideos;
    const catalog = new Map(videos.map(item => [item.id, item]));
    const items = queue.map(item => catalog.get(item.id) ?? item);
    return selectedVideo && !items.some(item => item.id === selectedVideo.id) ? [selectedVideo, ...items] : items;
  }, [playerQueue, filteredVideos, videos, selectedVideo]);

  if (page === "login" || (page === "admin" && !session)) {
    return <div className="theme-classic dark auth-screen">
      <header className="auth-header">
        <div className="auth-brand"><span><MonitorPlay size={24} /></span><strong>Video Vault</strong></div>
        <Button variant="ghost" onClick={() => openPage("videos")}><ArrowLeft size={16} />В медиатеку</Button>
      </header>
      <main className="auth-main">
        <div className="auth-window"><div className="auth-emblem"><Lock size={22} /></div><AuthForm onLogin={handleLogin} /></div>
      </main>
    </div>;
  }

  return (
    <div className={`app-shell page-${page} theme-${theme} ${theme === "classic" ? "dark" : ""}`}>
      {theme === "glass" && <Wallpaper variant={wallpaper} staticOnly={page === "player"} />}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <MonitorPlay size={23} aria-hidden="true" />
          </span>
          <div>
            <strong>Video Vault</strong>
            <span>Личная медиатека</span>
          </div>
        </div>

        <nav className="main-nav" aria-label="Основные разделы">
          <Button variant="ghost" aria-current={page === "videos" ? "page" : undefined} className={page === "videos" ? "active" : ""} onClick={() => openPage("videos")}>
            <Grid2X2 size={18} />
            <span>Видео</span>
          </Button>
          <Button variant="ghost" aria-current={page === "files" ? "page" : undefined} className={page === "files" ? "active" : ""} onClick={() => openPage("files")}>
            <FolderOpen size={18} />
            <span>Все файлы</span>
          </Button>
          <Button variant="ghost" aria-current={page === "admin" ? "page" : undefined} className={page === "admin" ? "active" : ""} onClick={() => openPage("admin")}>
            <Settings size={18} />
            <span>Управление</span>
          </Button>
          <Button variant="ghost" aria-current={page === "settings" ? "page" : undefined} className={page === "settings" ? "settings-entry active" : "settings-entry"} onClick={() => openPage("settings")}>
            <SlidersHorizontal size={18} />
            <span>Настройки</span>
          </Button>
        </nav>
        <div className="nav-section-label">Коллекции</div>
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
        <Button variant="ghost" className="sidebar-account" onClick={() => openPage(session ? "settings" : "login")}>
          <UserRound size={19} />
          <span><strong>{session?.login || "Гостевой просмотр"}</strong><small>{session ? "Настройки аккаунта" : "Войти в аккаунт"}</small></span>
          <ChevronRight size={16} />
        </Button>
      </aside>

      <main ref={contentRef} className={page === "player" ? "content player-page" : "content"}>
        {page === "player" && selectedVideo ? (
          <PlayerPage key={selectedVideo.id} video={selectedVideo} playlist={playerPlaylist} onSelectVideo={openPlayer} onBack={closePlayer} />
        ) : page === "player" ? (
          <section className="empty-folder">
            <MonitorPlay size={34} />
            <h2>Загрузка видео</h2>
            <p>Восстанавливаем открытый плеер после обновления страницы.</p>
          </section>
        ) : null}
        {page === "settings" ? (<SettingsPanel theme={theme} wallpaper={wallpaper} session={session} onThemeChange={setTheme} onWallpaperChange={setWallpaper} onOpenLogin={() => openPage("login")} onLogout={handleLogout} />) : page === "admin" ? (
          <AccountCenter session={session} onLogin={handleLogin} onLogout={handleLogout}><AdminPage
            folders={rootFolders}
            allFolders={folders}
            videos={videos}
            scrollContainerRef={contentRef}
            session={session}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onFolderCreated={handleFolderCreated}
            onFolderUpdated={handleFolderUpdated}
            onFolderDeleted={handleFolderDeleted}
            onVideoUpdated={handleVideoUpdated}
            onVideoDeleted={handleVideoDeleted}
            onFileDeleted={handleFileDeleted}
          /></AccountCenter>
        ) : (
          <div className="browse-page" hidden={page === "player"}>
            <header className="topbar">
              <div>
                <p className="eyebrow">{theme === "classic" ? "Медиатека / " + (browsePage === "files" ? "Файлы" : "Видео") : pageEyebrow}</p>
                <h1>{pageTitle}</h1>
              </div>
              <button className="icon-text" onClick={() => openPage(session ? "settings" : "login")}>
                <Shield size={18} />
                <span>{session ? session.login : "Войти"}</span>
              </button>
            </header>
            {loadError && <p className="error app-error">{loadError}</p>}

            <section className="toolbar" aria-label="Фильтры">
              <label className="search-box">
                <Search size={18} />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Поиск в библиотеке"
                  placeholder={browsePage === "files" ? "Поиск по папкам, видео и файлам" : "Поиск по названию видео"}
                />
              </label>

              <div className="toolbar-controls">
                {theme === "classic" ? <>
                  {browsePage === "files" && <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="outline"><FileTypeIcon type={fileTypeFilter} /><span>{fileTypeLabels[fileTypeFilter]}</span><ChevronDown size={14} /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="vault-menu dark">
                      <DropdownMenuRadioGroup value={fileTypeFilter} onValueChange={(value) => setFileTypeFilter(value as FileTypeFilter)}>
                        {(["videos", "files", "images", "all"] as FileTypeFilter[]).map(type => <DropdownMenuRadioItem key={type} value={type}><FileTypeIcon type={type} />{fileTypeLabels[type]}</DropdownMenuRadioItem>)}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="outline" aria-label="Сортировка"><ArrowDownAZ size={16} /><span>{sortField === "name" ? "По имени" : "По дате"}</span><ChevronDown size={14} /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="vault-menu dark">
                      <DropdownMenuRadioGroup value={sortField} onValueChange={(value) => { setSortField(value as SortField); setSortDirection(value === "name" ? "asc" : "desc"); }}>
                        <DropdownMenuRadioItem value="name">По имени</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="date">По дате</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="outline" size="icon" onClick={() => setSortDirection(current => current === "asc" ? "desc" : "asc")} title={sortDirection === "asc" ? "По возрастанию" : "По убыванию"} aria-label={sortDirection === "asc" ? "По возрастанию" : "По убыванию"}>{sortDirection === "asc" ? <ArrowUp size={17} /> : <ArrowDown size={17} />}</Button>
                  <Tabs value={viewMode} onValueChange={value => setViewMode(value as ViewMode)}>
                    <TabsList aria-label="Вид списка"><TabsTrigger value="tiles" aria-label="Плитка" title="Плитка"><Grid2X2 size={17} /></TabsTrigger><TabsTrigger value="list" aria-label="Список" title="Список"><List size={17} /></TabsTrigger></TabsList>
                  </Tabs>
                </> : <>
                {browsePage === "files" && (
                  <details className="sort-menu type-filter-menu">
                    <summary aria-label={`Тип содержимого: ${fileTypeLabels[fileTypeFilter]}`}>
                      <FileTypeIcon type={fileTypeFilter} />
                      <span>{fileTypeLabels[fileTypeFilter]}</span>
                      <ChevronDown size={16} />
                    </summary>
                    <div className="sort-options">
                      {(["videos", "files", "images", "all"] as FileTypeFilter[]).map((type) => (
                        <button
                          key={type}
                          className={fileTypeFilter === type ? "selected" : ""}
                          onClick={(event) => {
                            setFileTypeFilter(type);
                            event.currentTarget.closest("details")?.removeAttribute("open");
                          }}
                          title={type === "files" ? "Обычные файлы, кроме изображений" : fileTypeLabels[type]}
                        >
                          <FileTypeIcon type={type} />
                          <span>{fileTypeLabels[type]}</span>
                          {fileTypeFilter === type && <Check size={16} />}
                        </button>
                      ))}
                    </div>
                  </details>
                )}

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
                </>}
              </div>
            </section>

            {browsePage === "files" ? (
              <FileBrowser
                entries={visibleFileEntries}
                breadcrumbs={breadcrumbs}
                currentFolder={currentFolder}
                viewMode={viewMode}
                fileTypeFilter={fileTypeFilter}
                canDeleteFiles={isAdminSession}
                onOpenFolder={(folder) => setCurrentFolderId(folder.id)}
                onOpenRoot={() => setCurrentFolderId(null)}
                onOpenVideo={openPlayer}
                onFileDeleted={handleFileDeleted}
              />
            ) : (
              <>
                <div className="collection-heading">
                  <h2>{query ? "Результаты поиска" : selectedFolder === "all" ? "Вся коллекция" : folders.find((folder) => folder.id === selectedFolder)?.name ?? "Коллекция"} <Badge variant="secondary">{filteredVideos.length}</Badge></h2>
                  <span>Локальная библиотека</span>
                </div>
                {filteredVideos.length === 0 && (
                  <div className="night-empty"><Search size={28} /><h2>{loadError ? "Библиотека недоступна" : query ? "Ничего не нашлось" : "В коллекции пока нет видео"}</h2><p>{loadError ? "Не удалось получить данные с сервера. Проверьте соединение и обновите страницу." : query ? "Попробуйте другое название или выберите другую папку." : "Добавленные видео появятся в этой коллекции."}</p></div>
                )}

                <section className={viewMode === "tiles" ? "video-grid" : "video-list"} aria-label="Видео">
                  {filteredVideos.map((video) => (
                    <VideoItem key={video.id} video={video} mode={viewMode} onPlay={() => openPlayer(video)} />
                  ))}
                </section>
              </>
            )}
          </div>
        )}
      </main>
      {showBackToTop && page !== "player" && <button className="back-to-top" aria-label="Вернуться в начало" title="Наверх" onClick={() => {
        const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
        if (isMobileLayout()) window.scrollTo({ top: 0, behavior });
        else contentRef.current?.scrollTo({ top: 0, behavior });
      }}><ArrowUp size={20} /></button>}
    </div>
  );
}

const wallpaperChoices: Array<{ id: WallpaperVariant; title: string; description: string; video?: string; image?: string }> = [
  { id: "slime", title: "Slime", description: "Интерактивный · следует за курсором", image: "/media/slime/preview.gif" },
  { id: "good-bad", title: "Good Bad Fake", description: "Живая сцена · Wallpaper Engine", image: "/media/good-bad-fake/preview.gif" },
  { id: "rostislav", title: "Rostislav Uzunov", description: "Новый видеофон", video: "/media/rostislav-uzunov-7670836.mp4#t=0.5" },
  { id: "hunt", title: "Hunt: дым и золото", description: "Текущий живой фон", video: "/media/hunt-showdown.mp4#t=0.5" },
  { id: "dark", title: "Чистый тёмный", description: "Спокойный фон без видео" },
  { id: "water", title: "Black Water", description: "Предыдущая водная иллюзия", video: "/media/black-water-illusion.mp4#t=0.5" }
];

function SettingsPanel({ theme, wallpaper, session, onThemeChange, onWallpaperChange, onOpenLogin, onLogout }: {
  theme: "classic" | "glass";
  wallpaper: WallpaperVariant;
  session: AdminSession | null;
  onThemeChange: (theme: "classic" | "glass") => void;
  onWallpaperChange: (wallpaper: WallpaperVariant) => void;
  onOpenLogin: () => void;
  onLogout: () => void;
}) {
  return <section className="settings-panel settings-page" aria-labelledby="settings-title">
      <header className="settings-header">
        <div><span>VIDEO VAULT</span><h1 id="settings-title">Настройки</h1></div>
      </header>

      <div className="settings-section">
        <div className="settings-section-title"><Settings size={18} /><div><h3>Оформление</h3><p>Выберите внешний вид интерфейса</p></div></div>
        <div className="theme-choice" role="group" aria-label="Тема оформления">
          <button aria-pressed={theme === "classic"} onClick={() => onThemeChange("classic")}>
            <span className="theme-swatch classic-swatch"><i /><i /><i /></span>
            <span><strong>Классическая</strong><small>Тёмная рабочая область</small></span>
            {theme === "classic" && <Check size={18} />}
          </button>
          <button aria-pressed={theme === "glass"} onClick={() => onThemeChange("glass")}>
            <span className="theme-swatch glass-swatch"><i /><i /><i /></span>
            <span><strong>Стекло</strong><small>Видео и матовые поверхности</small></span>
            {theme === "glass" && <Check size={18} />}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title"><MonitorPlay size={18} /><div><h3>Фон</h3><p>Фон используется в теме «Стекло»</p></div></div>
        <div className="wallpaper-choice" role="radiogroup" aria-label="Фоновое оформление">
          {wallpaperChoices.map((choice) => <button
            key={choice.id}
            role="radio"
            aria-checked={wallpaper === choice.id}
            className={wallpaper === choice.id ? "selected" : ""}
            onClick={() => onWallpaperChange(choice.id)}
          >
            <span className={`wallpaper-preview preview-${choice.id}`}>
              {choice.image && <img src={choice.image} alt="" loading="lazy" />}
              {choice.video && <video src={choice.video} muted playsInline preload="metadata" />}
              <span>{wallpaper === choice.id && <Check size={17} />}</span>
            </span>
            <strong>{choice.title}</strong>
            <small>{choice.description}</small>
          </button>)}
        </div>
      </div>

      <div className="settings-section account-settings">
        <div className="settings-section-title"><UserRound size={18} /><div><h3>Аккаунт</h3><p>{session ? `Вы вошли как ${session.login}` : "Войдите для управления медиатекой"}</p></div></div>
        <div className="settings-account-card">
          <span className="settings-avatar">{session ? session.login.slice(0, 2).toUpperCase() : <UserRound size={20} />}</span>
          <span><strong>{session?.login ?? "Гость"}</strong><small>{session ? (session.role === "admin" ? "Администратор" : "Пользователь") : "Аккаунт не подключён"}</small></span>
          {session && <button className="settings-logout" onClick={onLogout} aria-label="Выйти из аккаунта"><LogOut size={18} /></button>}
        </div>
        {session ? <div className="account-center settings-account-form"><PasswordForm /></div> : <Button className="primary-button" onClick={onOpenLogin}>Войти в аккаунт</Button>}
      </div>
    </section>;
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

function FileBrowser({
  entries,
  breadcrumbs,
  currentFolder,
  viewMode,
  fileTypeFilter,
  canDeleteFiles,
  onOpenFolder,
  onOpenRoot,
  onOpenVideo,
  onFileDeleted
}: {
  entries: FileBrowserEntry[];
  breadcrumbs: VaultFolder[];
  currentFolder: VaultFolder | null;
  viewMode: ViewMode;
  fileTypeFilter: FileTypeFilter;
  canDeleteFiles: boolean;
  onOpenFolder: (folder: VaultFolder) => void;
  onOpenRoot: () => void;
  onOpenVideo: (video: VideoFile) => void;
  onFileDeleted: (fileId: string) => void;
}) {
  const [previewFile, setPreviewFile] = useState<SharedFile | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const folderCount = entries.filter((entry) => entry.type === "folder").length;
  const videoCount = entries.filter((entry) => entry.type === "video").length;
  const fileCount = entries.filter((entry) => entry.type === "file").length;

  const removeFile = async (file: SharedFile) => {
    const displayName = getFileDisplayName(file);
    if (!window.confirm(`Удалить файл «${displayName}» из медиатеки? Файл на диске останется без изменений.`)) return;

    setDeletingFileId(file.id);
    setDeleteError("");
    try {
      await deleteMediaFile(file.id);
      setPreviewFile((current) => current?.id === file.id ? null : current);
      onFileDeleted(file.id);
    } catch (nextError) {
      setDeleteError(nextError instanceof Error ? nextError.message : "Не удалось удалить файл.");
    } finally {
      setDeletingFileId(null);
    }
  };

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

      {deleteError && <p className="error file-delete-error" role="alert">{deleteError}</p>}

      {entries.length === 0 ? (
        <section className="empty-folder">
          <FolderOpen size={34} />
          <h2>Нет содержимого типа «{fileTypeLabels[fileTypeFilter]}»</h2>
          <p>Выберите другой тип в фильтре или откройте другую папку.</p>
        </section>
      ) : (
        <section className={viewMode === "tiles" ? "file-grid" : "file-list"} aria-label="Все файлы">
          {entries.map((entry) =>
            entry.type === "folder" ? (
              <FolderItem key={entry.folder.id} folder={entry.folder} onOpen={() => onOpenFolder(entry.folder)} />
            ) : entry.type === "video" ? (
              <VideoItem key={entry.video.id} video={entry.video} mode={viewMode} onPlay={() => onOpenVideo(entry.video)} />
            ) : (
              <FileItem
                key={entry.file.id}
                file={entry.file}
                onPreview={() => setPreviewFile(entry.file)}
                onDelete={canDeleteFiles ? () => { void removeFile(entry.file); } : undefined}
                isDeleting={deletingFileId === entry.file.id}
              />
            )
          )}
        </section>
      )}
      {previewFile && <ImageViewer file={previewFile} onClose={() => setPreviewFile(null)} />}
    </>
  );
}

function isImageFile(file: SharedFile) {
  if (file.mimeType?.toLowerCase().startsWith("image/")) {
    return true;
  }

  return ["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"].includes(
    getFileExtension(file).toLowerCase()
  );
}

function getFileExtension(file: Pick<SharedFile, "extension" | "name">) {
  const explicitExtension = file.extension?.trim().replace(/^\.+/, "");
  if (explicitExtension) {
    return explicitExtension.toUpperCase();
  }

  const name = file.name.split(/[\\/]/).pop() ?? file.name;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return "ФАЙЛ";
  }

  return name.slice(dotIndex + 1).toUpperCase();
}

function getFileDisplayName(file: Pick<SharedFile, "extension" | "name">) {
  const extension = getFileExtension(file);
  if (extension === "ФАЙЛ") {
    return file.name;
  }

  const suffix = `.${extension.toLowerCase()}`;
  return file.name.toLowerCase().endsWith(suffix) ? file.name : `${file.name}${suffix}`;
}

function getFileDisplaySize(file: Pick<SharedFile, "size" | "sizeBytes">) {
  const size = file.size?.trim();
  if (size && !/^\d+(?:\.\d+)?$/.test(size)) {
    return size;
  }

  const bytes = Number.isFinite(file.sizeBytes) ? file.sizeBytes : Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return size;
  }

  if (bytes < 1024) {
    return `${bytes} Б`;
  }

  const units = ["КБ", "МБ", "ГБ", "ТБ"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
  const value = bytes / 1024 ** (unitIndex + 1);
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: value >= 10 ? 1 : 2 }).format(value)} ${units[unitIndex]}`;
}

function FileItem({ file, onPreview, onDelete, isDeleting = false }: {
  file: SharedFile;
  onPreview: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
}) {
  const image = isImageFile(file);
  const extension = getFileExtension(file);
  const extensionLabel = extension === "ФАЙЛ" ? extension : `.${extension}`;
  const displayName = getFileDisplayName(file);
  const displaySize = getFileDisplaySize(file);
  const fileUrl = getFileDownloadUrl(file.id);
  const content = (
    <>
      <span className={image ? "file-preview image" : "file-preview"}>
        {image ? (
          <img src={fileUrl} alt="" loading="lazy" />
        ) : (
          <span className="file-type-preview">
            <FileIcon size={38} />
            <b>{extensionLabel}</b>
          </span>
        )}
      </span>
      <span className="file-copy">
        <strong title={displayName}>{displayName}</strong>
        <span className="file-meta">
          <b>{extensionLabel}</b>
          {displaySize && <small>{displaySize}</small>}
        </span>
      </span>
      <span className="file-action-icon" aria-hidden="true">
        {image ? <ImageIcon size={18} /> : <Download size={18} />}
      </span>
    </>
  );

  return (
    <article className="shared-file-card">
      {onDelete && <button
        type="button"
        className="file-delete-button"
        onClick={onDelete}
        disabled={isDeleting}
        title="Удалить из медиатеки"
        aria-label={`Удалить файл ${displayName}`}
      >
        {isDeleting ? <RefreshCw className="spin" size={17} /> : <Trash2 size={17} />}
      </button>}
      {image ? (
        <button className="shared-file-open" onClick={onPreview} aria-label={`Открыть изображение ${displayName}`}>
          {content}
        </button>
      ) : (
        <a className="shared-file-open" href={fileUrl} download={displayName} aria-label={`Скачать ${displayName}`}>
          {content}
        </a>
      )}
    </article>
  );
}

function ImageViewer({ file, onClose }: { file: SharedFile; onClose: () => void }) {
  return <ImageLightbox src={getFileDownloadUrl(file.id)} name={getFileDisplayName(file)} description={[getFileExtension(file), getFileDisplaySize(file)].filter(Boolean).join(" · ")} onClose={onClose} />;
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
  const posterUrl = getVideoPosterUrl(video.id, video.posterRevision);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [shouldLoad, setShouldLoad] = useState(() => posterPreviewCache.has(posterUrl));
  const [loadedPoster, setLoadedPoster] = useState<{ requestUrl: string; previewUrl: string } | null>(() => {
    const previewUrl = posterPreviewCache.get(posterUrl);
    return previewUrl ? { requestUrl: posterUrl, previewUrl } : null;
  });
  const posterUnavailable = failedUrl === posterUrl;

  useEffect(() => {
    posterPreviewUsers.set(posterUrl, (posterPreviewUsers.get(posterUrl) ?? 0) + 1);
    return () => {
      const remaining = (posterPreviewUsers.get(posterUrl) ?? 1) - 1;
      if (remaining) posterPreviewUsers.set(posterUrl, remaining);
      else posterPreviewUsers.delete(posterUrl);
      // Let replacement cards acquire cached URLs in the same React commit first.
      queueMicrotask(trimPosterPreviewCache);
    };
  }, [posterUrl]);

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
      <VideoProblemBadge id={video.id} />
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

function PlayerPage({ video, playlist, onSelectVideo, onBack }: {
  video: VideoFile;
  playlist: VideoFile[];
  onSelectVideo: (video: VideoFile) => void;
  onBack: () => void;
}) {
  const duration = formatDuration(video.duration);
  const mediaRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [holdingSpeed, setHoldingSpeed] = useState(false);
  const holdRef = useRef<ReturnType<typeof createHoldToSpeed> | null>(null);
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const hold = createHoldToSpeed(media, setHoldingSpeed);
    holdRef.current = hold;
    const stop = () => hold.stop();
    const visibility = () => { if (document.hidden) stop(); };
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", visibility);
    media.addEventListener("pause", stop);
    media.addEventListener("ended", stop);
    return () => {
      stop();
      holdRef.current = null;
      window.removeEventListener("pointerup", stop, true);
      window.removeEventListener("pointercancel", stop, true);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", visibility);
      media.removeEventListener("pause", stop);
      media.removeEventListener("ended", stop);
    };
  }, []);
  useLayoutEffect(() => {
    const media = mediaRef.current;
    const stage = stageRef.current;
    const layout = stage?.closest<HTMLElement>(".watch-layout");
    if (!media || !stage || !layout) return;
    const updateAspect = () => {
      if (media.videoWidth && media.videoHeight) setVideoAspect(media.videoWidth / media.videoHeight);
    };
    const measure = () => {
      if (stage.matches(":fullscreen") || stage.classList.contains("app-fullscreen")) return;
      layout.style.setProperty("--watch-player-height", `${stage.getBoundingClientRect().height}px`);
    };
    updateAspect();
    measure();
    media.addEventListener("loadedmetadata", updateAspect);
    media.addEventListener("resize", updateAspect);
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => {
      observer.disconnect();
      media.removeEventListener("loadedmetadata", updateAspect);
      media.removeEventListener("resize", updateAspect);
    };
  }, []);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [waitingForAudio, setWaitingForAudio] = useState(false);
  const [slowLoading, setSlowLoading] = useState(false);
  const [error, setError] = useState("");
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const extension = video.extension?.trim().replace(/^\./, "").toLowerCase();
  const isMkv = extension ? extension === "mkv" : /\.mkv$/i.test(video.path);
  const hlsRef = useRef<ReturnType<typeof attachHls> | null>(null);
  const [audio, setAudio] = useState<{ tracks: PlaybackAudioTrack[]; selected: number }>({ tracks: [], selected: -1 });
  const [audioLabels, setAudioLabels] = useState<Record<string, string>>({});
  const isBuffering = waiting || waitingForAudio;
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    const useRanges = ("MediaSource" in window || "ManagedMediaSource" in window) && /\.mp4$/i.test(video.path || video.title)
      && video.sizeBytes > 512 * 1024 * 1024;
    if (isMkv) {
      const controller = new AbortController();
      setWaiting(true);
      setAudio({ tracks: [], selected: -1 });
      setAudioLabels({});
      setWaitingForAudio(false);

      const failHls = (message: string, audioUnavailable?: boolean) => {
        if (cancelled || controller.signal.aborted) return;
        controller.abort();
        media.pause();
        hlsRef.current?.destroy();
        hlsRef.current = null;
        setWaitingForAudio(false);
        setWaiting(false);
        setError(audioUnavailable ? `Не удалось загрузить аудиодорожку. ${message}` : message);
      };
      void getVideoAudioTracks(video.id, controller.signal).then(tracks => {
        if (!cancelled && !controller.signal.aborted) {
          setAudioLabels(Object.fromEntries(tracks.map(track => [track.id, track.title?.trim() || track.language])));
        }
      }).catch(() => { /* Manifest labels remain available. */ });
      void import("./hlsPlayback").then(({ attachHls }) => {
        if (cancelled) return;
        hlsRef.current = attachHls(media, getHlsMasterUrl(video.id), (tracks, selected) => {
          if (!cancelled && !controller.signal.aborted) setAudio({ tracks, selected });
        }, failHls, waiting => { if (!cancelled) setWaitingForAudio(waiting); });
      }).catch(() => failHls("Не удалось загрузить HLS-плеер."));

      cleanup = () => {
        controller.abort();
        hlsRef.current?.destroy();
        hlsRef.current = null;
      };
    } else if (useRanges) {
      void import("./progressiveMp4").then(({ progressiveMp4 }) => {
        if (cancelled) return;
        cleanup = progressiveMp4(media, video.streamUrl, message => { setWaiting(false); setError(message); });
      }).catch(() => { if (!cancelled) media.src = video.streamUrl; });
    } else media.src = video.streamUrl;
    return () => { cancelled = true; cleanup?.(); };
  }, [video.id, video.streamUrl, video.path, video.title, video.sizeBytes, isMkv, playbackAttempt]);
  const [speed, setSpeed] = useState(1);
  const [ambient, setAmbient] = useState(() => {
    try { return localStorage.getItem("vault-player-ambient") !== "off"; } catch { return true; }
  });
  const [playerSettings, setPlayerSettings] = useState<"main" | "speed" | "audio" | null>(null);
  const [autoplayNext, setAutoplayNext] = useState(() => {
    try { return localStorage.getItem("vault-player-autoplay") !== "off"; } catch { return true; }
  });
  const currentIndex = Math.max(0, playlist.findIndex(item => item.id === video.id));
  const previousVideo = playlist[currentIndex - 1];
  const nextVideo = playlist[currentIndex + 1];
  useEffect(() => {
    try { localStorage.setItem("vault-player-autoplay", autoplayNext ? "on" : "off"); } catch { /* Keep the current session preference. */ }
  }, [autoplayNext]);
  const audioLabel = (track: PlaybackAudioTrack) => (track.id && audioLabels[track.id]) || track.label;
  const selectedAudio = audio.tracks.find(track => track.index === audio.selected);
  const settingsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isBuffering || error) {
      setSlowLoading(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowLoading(true), 15000);
    return () => window.clearTimeout(timer);
  }, [isBuffering, error]);
  useEffect(() => {
    try { localStorage.setItem("vault-player-ambient", ambient ? "on" : "off"); } catch { /* Session preference remains usable. */ }
  }, [ambient]);
  useEffect(() => {
    if (!playerSettings) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !settingsRef.current?.contains(event.target)) setPlayerSettings(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [playerSettings]);
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
      seekforward: (details) => seek(details.seekOffset ?? 5),
      previoustrack: previousVideo ? () => onSelectVideo(previousVideo) : undefined,
      nexttrack: nextVideo ? () => onSelectVideo(nextVideo) : undefined
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
      for (const action of ["play", "pause", "seekbackward", "seekforward", "previoustrack", "nexttrack"] as MediaSessionAction[]) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore actions unsupported by the current browser.
        }
      }
    };
  }, [video, previousVideo, nextVideo, onSelectVideo]);
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
    if (media.paused) void media.play().catch((playError: unknown) => {
      if (playError instanceof DOMException && playError.name === "AbortError") return;
      setWaiting(false);
      setPlaying(false);
      setError("Не удалось начать воспроизведение. Проверьте соединение и формат видео или попробуйте ещё раз.");
    });
    else media.pause();
  };
  const retryPlayback = () => {
    const media = mediaRef.current;
    if (!media) return;
    setError("");
    setSlowLoading(false);
    setWaiting(true);
    setPlaybackAttempt(attempt => attempt + 1);
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
        <Button variant="outline" className="player-back-button" onClick={onBack} type="button" aria-label="Вернуться назад">
          <ArrowLeft size={18} />
          <span>Назад</span>
        </Button>
        <div>
          <p className="eyebrow">Медиатека / Плеер</p>
          <h1>{video.title}</h1>
          <span title={video.path}>{video.folderName || video.path}</span>
        </div>
        <VideoProblemControl key={video.id} id={video.id} title={video.title} getTime={() => mediaRef.current?.currentTime ?? 0} />
      </header>

      <div className="watch-layout"><div className="watch-main">
      <section className={`player-surface custom-player ${controlsVisible || playerSettings || !playing || isBuffering || error ? "controls-visible" : ""} ${forcedLandscape ? "forced-landscape" : ""} ${isAppFullscreen ? "app-fullscreen" : ""}`} ref={stageRef}
        style={{ "--video-aspect": videoAspect, "--video-width-limit": `calc(min(70dvh, 760px) * ${videoAspect})` } as CSSProperties}
        tabIndex={0} aria-label="Видеоплеер" onPointerMove={revealControls} onFocus={revealControls}
        onKeyDown={(event) => {
          if (event.key === "Escape" && playerSettings) {
            event.preventDefault(); setPlayerSettings(null);
            settingsRef.current?.querySelector("button")?.focus(); return;
          }
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
        {ambient && !isNativeFullscreen && !isAppFullscreen && <PlayerAmbient mediaRef={mediaRef} source={video.streamUrl} />}
        <div className="video-stage"
          onPointerDownCapture={event => {
            if (event.button !== 0 || event.pointerType === "touch") return;
            if ((event.target as HTMLElement).closest("button:not(.center-play)")) return;
            const target = (event.target as Element).closest("video,.center-play");
            if (!mediaRef.current?.paused && target) {
              try { target.setPointerCapture(event.pointerId); } catch { /* Synthetic pointers have no active capture. */ }
            }
            holdRef.current?.start();
          }}
          onLostPointerCapture={() => holdRef.current?.stop()}
          onClickCapture={event => {
            if (!holdRef.current?.consumeClick()) return;
            event.preventDefault();
            event.stopPropagation();
          }}>
          <video ref={mediaRef}
          autoPlay
          playsInline
          preload="metadata"
          poster={getVideoPosterUrl(video.id, video.posterRevision)}
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
            onCanPlay={() => setWaiting(false)} onEnded={() => {
              setPlaying(false);
              if (autoplayNext && nextVideo) onSelectVideo(nextVideo);
            }}
            onError={event => {
              setWaitingForAudio(false);
              setWaiting(false);
              if (isMkv) {
                setError(current => current || "Не удалось воспроизвести MKV через HLS.");
                return;
              }
              const code = event.currentTarget.error?.code;
              setError(code === 2 ? "Ошибка сети при загрузке видео. Проверьте соединение и попробуйте ещё раз." : code === 3 ? "Браузер не смог декодировать видео. Возможно, файл повреждён или использует неподдерживаемый кодек." : "Не удалось открыть видео. Проверьте доступность файла и поддерживаемый формат.");
            }} />
          {isBuffering && !error && <div className="player-loading" role="status"><RefreshCw className="spin" size={22} /><span>{waitingForAudio ? "Загрузка аудиодорожки" : slowLoading ? "Загрузка занимает больше времени. Проверьте соединение или попробуйте снова." : "Загрузка видео"}</span></div>}
          {!isBuffering && !error && (controlsVisible || !playing) && (
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
          {holdingSpeed && <div className="player-speed-hold" role="status"><SkipForward size={16} fill="currentColor" /><span>2x</span></div>}
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
          style={{ background: `linear-gradient(to right, var(--player-accent, #fca311) ${length ? position / length * 100 : 0}%, #ffffff70 ${length ? position / length * 100 : 0}%, #ffffff70 ${length ? buffered / length * 100 : 0}%, #ffffff30 ${length ? buffered / length * 100 : 0}%)` }}
          onChange={event => { const value = Number(event.target.value); if (mediaRef.current) mediaRef.current.currentTime = value; setPosition(value); revealControls(); }} />
        <div className="playback-tools">
          <button className="queue-previous" disabled={!previousVideo} onClick={() => previousVideo && onSelectVideo(previousVideo)} title="Предыдущее видео" aria-label="Предыдущее видео"><SkipBack size={20} /></button>
          <button className="seek-control" onClick={() => seek(-10)} title="Назад на 10 секунд" aria-label="Назад на 10 секунд"><RotateCcw size={20} /><small>10</small></button>
          <button className="playback-primary" onClick={togglePlayback} title={playing ? "Пауза" : "Воспроизвести"} aria-label={playing ? "Пауза" : "Воспроизвести"}>{playing ? <Pause size={22} /> : <Play size={22} />}</button>
          <button className="seek-control" onClick={() => seek(10)} title="Вперёд на 10 секунд" aria-label="Вперёд на 10 секунд"><RotateCw size={20} /><small>10</small></button>
          <button className="queue-next" disabled={!nextVideo} onClick={() => nextVideo && onSelectVideo(nextVideo)} title="Следующее видео" aria-label="Следующее видео"><SkipForward size={20} /></button>
          <button className="player-mute-button" onClick={() => { if (mediaRef.current) mediaRef.current.muted = !muted; }} title={muted ? "Включить звук" : "Выключить звук"} aria-label={muted ? "Включить звук" : "Выключить звук"}>{muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}</button>
          <input className="player-volume" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Громкость" onChange={event => { if (mediaRef.current) { mediaRef.current.volume = Number(event.target.value); mediaRef.current.muted = false; } }} />
          <span className="player-clock">{clock(position)} / {clock(length)}</span>
          <div className="player-settings" ref={settingsRef}>
            <button type="button" className="player-settings-trigger" title="Настройки" aria-label="Настройки плеера" aria-expanded={playerSettings !== null}
              onClick={() => setPlayerSettings(playerSettings ? null : "main")}><Settings size={20} /></button>
            {playerSettings && <div className="player-settings-panel" role="group" aria-label="Настройки плеера">
              {playerSettings === "main" ? <>
                <button role="switch" aria-checked={ambient} onClick={() => setAmbient(value => !value)}>
                  <span>Фоновая подсветка</span><span className={ambient ? "player-switch enabled" : "player-switch"} aria-hidden="true" />
                </button>
                <button onClick={() => setPlayerSettings("speed")}><span>Скорость</span><span>{speed}×</span><ChevronRight size={16} /></button>
                {isMkv && audio.tracks.length > 0 && <button onClick={() => setPlayerSettings("audio")}>
                  <span>Аудиодорожка</span>
                  {selectedAudio && <span className="player-setting-value" title={audioLabel(selectedAudio)}>{audioLabel(selectedAudio)}</span>}
                  <ChevronRight size={16} />
                </button>}
              </> : playerSettings === "audio" ? <>
                <button onClick={() => setPlayerSettings("main")}><ArrowLeft size={16} /><span>Аудиодорожки</span></button>
                {audio.tracks.map(track => <button key={track.index} aria-pressed={audio.selected === track.index}
                  onClick={() => { hlsRef.current?.selectAudio(track.index); setPlayerSettings("main"); }}>
                  <span>{audioLabel(track)}</span>{audio.selected === track.index && <Check size={16} />}
                </button>)}
              </> : <>
                <button onClick={() => setPlayerSettings("main")}><ArrowLeft size={16} /><span>Скорость воспроизведения</span></button>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map(value => <button key={value} aria-pressed={speed === value} onClick={() => {
                  setSpeed(value); if (mediaRef.current) mediaRef.current.playbackRate = value; setPlayerSettings("main");
                }}><span>{value === 1 ? "Обычная" : value + "×"}</span>{speed === value && <Check size={16} />}</button>)}
              </>}
            </div>}
          </div>
          <button title={isAppFullscreen || isNativeFullscreen ? "Выйти из полноэкранного режима" : "Полный экран"} aria-label={isAppFullscreen || isNativeFullscreen ? "Выйти из полноэкранного режима" : "Полный экран"} onClick={() => { void fullscreen(); }}>
            {isAppFullscreen || isNativeFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        </div>
        </div>
        {(error || slowLoading) && <div className="player-message" role={error ? "alert" : "status"}>
          {error && <span>{error}</span>}
          <button type="button" onClick={retryPlayback}>Попробовать снова</button>
        </div>}
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
      </div>
      <PlayerPlaylist playlist={playlist} currentIndex={currentIndex} autoplay={autoplayNext} onAutoplayChange={setAutoplayNext}
        onSelect={onSelectVideo} renderPoster={item => <><PosterImage video={item} /><span>{formatDuration(item.duration)}</span></>} />
      </div>
    </>
  );
}

function AdminPage({
  folders,
  allFolders,
  videos,
  scrollContainerRef,
  session,
  onLogin,
  onLogout,
  onFolderCreated,
  onFolderUpdated,
  onFolderDeleted,
  onVideoUpdated,
  onVideoDeleted,
  onFileDeleted
}: {
  folders: VaultFolder[];
  allFolders: VaultFolder[];
  videos: VideoFile[];
  scrollContainerRef: RefObject<HTMLElement | null>;
  session: AdminSession | null;
  onLogin: (session: AdminSession) => void;
  onLogout: () => void;
  onFolderCreated: (payload: { folder: VaultFolder }) => void;
  onFolderUpdated: (folder: VaultFolder) => void;
  onFolderDeleted: (folderId: string) => Promise<void>;
  onVideoUpdated: (video: VideoFile) => void;
  onVideoDeleted: (videoId: string) => void;
  onFileDeleted: (fileId: string) => void;
}) {
  const [login, setLogin] = useState("admin");
  const confirmAction = useConfirmation();
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
  const [updatingPosterId, setUpdatingPosterId] = useState<string | null>(null);
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);

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
    const shouldDelete = await confirmAction(`Удалить путь "${folder.path}" из просмотра? Файлы на диске не удалятся.`);
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

  const deleteVideoItem = async (video: VideoFile) => {
    const shouldDelete = await confirmAction(`Удалить видео «${video.title}» из медиатеки?`);
    if (!shouldDelete) return false;

    setDeletingVideoId(video.id);
    setError("");
    try {
      await deleteMediaVideo(video.id);
      onVideoDeleted(video.id);
      return true;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось удалить видео.");
      return false;
    } finally {
      setDeletingVideoId(null);
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
          <Button className="ghost-button" onClick={onLogout}>
            <LogOut size={18} />
            <span>Выйти</span>
          </Button>
        )}
      </header>

      {!session ? (
        <form className="admin-form admin-page-card" onSubmit={submitLogin}>
          <label>
            Логин
            <Input value={login} onChange={(event) => { setLogin(event.target.value); setAccountStatus(null); }} autoComplete="username" />
          </label>
          <label>
            Пароль
            <Input
              value={password}
              onChange={(event) => { setPassword(event.target.value); setAccountStatus(null); }}
              type="password"
              autoComplete="current-password"
            />
          </label>
          {error && <p className="error">{error}</p>}
          {accountStatus && <AccountAuthStatus status={accountStatus} />}
          <Button className="primary-button" disabled={isBusy}>
            <Lock size={18} />
            <span>Войти</span>
          </Button>
        </form>
      ) : (
        <section className="admin-page-grid">
          <form className="add-folder admin-page-card" onSubmit={submitFolder}>
            <label>
              Подключённые папки
              <Input aria-label="Путь к папке на сервере" value={path} onChange={(event) => setPath(event.target.value)} placeholder="D:\\Video" disabled={isBusy} />
            </label>
            <div className="path-actions">
              <Button type="button" className="ghost-button" onClick={() => setPickerOpen(true)} disabled={isBusy}>
                <FolderOpen size={18} />
                <span>Выбрать</span>
              </Button>
              <Button className="primary-button" disabled={isBusy || !path.trim()}>
                <FolderPlus size={18} />
                <span>Добавить</span>
              </Button>
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

          <div className="folder-table admin-page-card" aria-label="Подключённые папки">
            {!folders.length && <p className="library-empty-inline">Пока нет подключённых папок.</p>}
            {folders.map((folder) => (
              <AdminFolderRow
                key={folder.id}
                folder={folder}
                isBusy={isBusy || updatingFolderId !== null || rescanningFolderId !== null}
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

          <AdminMediaManager
            folders={allFolders}
            videos={videos}
            scrollContainerRef={scrollContainerRef}
            updatingPosterId={updatingPosterId}
            deletingVideoId={deletingVideoId}
            disabled={updatingPosterId !== null || deletingVideoId !== null}
            onVideoChange={changePoster}
            onVideoDelete={deleteVideoItem}
            onVideoDeleted={onVideoDeleted}
            onFileDeleted={onFileDeleted}
          />
        </section>
      )}
    </>
  );
}

function AdminMediaManager({
  folders,
  videos,
  scrollContainerRef,
  updatingPosterId,
  deletingVideoId,
  disabled,
  onVideoChange,
  onVideoDelete,
  onVideoDeleted,
  onFileDeleted
}: {
  folders: VaultFolder[];
  videos: VideoFile[];
  scrollContainerRef: RefObject<HTMLElement | null>;
  updatingPosterId: string | null;
  deletingVideoId: string | null;
  disabled: boolean;
  onVideoChange: (video: VideoFile, file: File) => void;
  onVideoDelete: (video: VideoFile) => Promise<boolean>;
  onVideoDeleted: (videoId: string) => void;
  onFileDeleted: (fileId: string) => void;
}) {
  const confirmAction = useConfirmation();
  const sortedFolders = useMemo(
    () => [...folders].sort((left, right) => left.path.localeCompare(right.path, "ru", { numeric: true })),
    [folders]
  );
  const selectableFolders = useMemo(() => {
    const rootFolders = sortedFolders.filter((folder) => folder.isRoot);
    return rootFolders.length > 0 ? rootFolders : sortedFolders;
  }, [sortedFolders]);
  const [rootId, setRootId] = useState("");
  const [subfolderId, setSubfolderId] = useState("");
  const [loadedEntries, setLoadedEntries] = useState<{ folderId: string; entries: FileBrowserEntry[] } | null>(null);
  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [loading, setLoading] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selectedKeys, setSelectedKeys] = useState(new Set<string>());
  const [deletingSelection, setDeletingSelection] = useState(false);
  const requestVersion = useRef(0);

  const root = selectableFolders.find((folder) => folder.id === rootId);
  const subfolders = useMemo(
    () => root ? sortedFolders.filter((folder) => !folder.isRoot && folder.id !== root.id && folder.rootFolderId === root.id) : [],
    [root, sortedFolders]
  );
  const rootPath = root && `${root.path.replace(/\\/g, "/").replace(/\/+$/, "")}/`;
  const activeSubfolder = subfolders.find((folder) => folder.id === subfolderId);
  const folderId = activeSubfolder?.id ?? root?.id ?? "";
  const getSubfolderLabel = (folder: VaultFolder) => {
    const path = folder.path.replace(/\\/g, "/");
    return rootPath && path.startsWith(rootPath) ? path.slice(rootPath.length) : folder.name;
  };
  const subfolderLabel = activeSubfolder ? getSubfolderLabel(activeSubfolder) : "Весь корень";

  useEffect(() => {
    if (rootId && !root) setRootId("");
    if (subfolderId && !activeSubfolder) setSubfolderId("");
    if ((rootId && !root) || (subfolderId && !activeSubfolder)) setSelectedKeys(new Set());
  }, [root, rootId, activeSubfolder, subfolderId]);

  const loadMedia = useCallback(async () => {
    const version = ++requestVersion.current;
    setError("");
    if (!folderId) {
      setLoadedEntries(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const next = await getFolderEntries(folderId);
      if (version === requestVersion.current) setLoadedEntries({ folderId, entries: next });
    } catch (nextError) {
      if (version !== requestVersion.current) return;
      setLoadedEntries(null);
      setError(nextError instanceof Error ? nextError.message : "Не удалось загрузить файлы и видео.");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    void loadMedia();
    return () => { requestVersion.current++; };
  }, [loadMedia]);

  const availableEntries = useMemo(() => {
    const items = new Map<string, AdminMediaEntry>();
    if (loadedEntries?.folderId === folderId) {
      for (const entry of loadedEntries.entries) {
        if (entry.type !== "folder") items.set(adminMediaKey(entry), entry);
      }
    }
    for (const video of videos) {
      if (!folderId || video.parentFolderId === folderId || (!activeSubfolder && video.folderId === folderId)) {
        items.set(`video-${video.id}`, { type: "video", video });
      }
    }
    return [...items.values()];
  }, [activeSubfolder, folderId, loadedEntries, videos]);

  const mediaEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return availableEntries
      .filter((entry) => {
        if (!normalizedQuery) return true;
        const values = entry.type === "video"
          ? [entry.video.title, entry.video.path, entry.video.folderName]
          : [entry.file.name, entry.file.path, entry.file.extension];
        return values.some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) => compareFileEntries(left, right, sortField, sortDirection));
  }, [availableEntries, query, sortDirection, sortField]);

  const selectedEntries = availableEntries.filter(entry => selectedKeys.has(adminMediaKey(entry)));
  const busy = disabled || loading || deletingSelection || deletingFileId !== null;
  const selectRoot = (id: string) => {
    if (id === rootId && !subfolderId) return;
    setRootId(id);
    setSubfolderId("");
    setSelectedKeys(new Set());
  };
  const selectSubfolder = (id: string) => {
    if (id === subfolderId) return;
    setSubfolderId(id);
    setSelectedKeys(new Set());
  };
  const toggleSelection = (key: string) => setSelectedKeys(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const removeEntry = (key: string) => {
    setLoadedEntries(current => current && {
      ...current,
      entries: current.entries.filter(entry => entry.type === "folder" || adminMediaKey(entry) !== key)
    });
    setSelectedKeys(current => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };
  const removeSelected = async () => {
    if (busy || !selectedEntries.length) return;
    if (!await confirmAction(`Удалить выбранные объекты из медиатеки (${selectedEntries.length})?`)) return;
    setDeletingSelection(true);
    setError("");
    const failures: string[] = [];
    try {
      for (const entry of selectedEntries) {
        try {
          if (entry.type === "video") {
            await deleteMediaVideo(entry.video.id);
            onVideoDeleted(entry.video.id);
          } else {
            await deleteMediaFile(entry.file.id);
            onFileDeleted(entry.file.id);
          }
          removeEntry(adminMediaKey(entry));
        } catch (nextError) {
          const name = entry.type === "video" ? entry.video.title : getFileDisplayName(entry.file);
          failures.push(`${name} — ${nextError instanceof Error ? nextError.message : "ошибка удаления"}`);
        }
      }
      if (failures.length) setError(`Не удалось удалить ${failures.length} из ${selectedEntries.length}. ${failures.join("; ")}`);
    } finally {
      setDeletingSelection(false);
    }
  };

  const removeFile = async (file: SharedFile) => {
    const displayName = getFileDisplayName(file);
    if (!await confirmAction(`Удалить файл «${displayName}» из медиатеки? Файл на диске останется без изменений.`)) return;

    setDeletingFileId(file.id);
    setError("");
    try {
      await deleteMediaFile(file.id);
      removeEntry(`file-${file.id}`);
      onFileDeleted(file.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось удалить файл.");
    } finally {
      setDeletingFileId(null);
    }
  };

  const removeVideo = async (video: VideoFile) => {
    if (!await onVideoDelete(video)) return;
    removeEntry(`video-${video.id}`);
  };

  return (
    <section className="admin-media-manager admin-page-card">
      <header className="poster-manager-header">
        <div>
          <h2>Файлы и видео</h2>
          <span>Всего: {mediaEntries.length}</span>
        </div>
      </header>

      <Tabs value={root?.id ?? "all-videos"} onValueChange={value => selectRoot(value === "all-videos" ? "" : value)} className="library-folder-tabs">
        <TabsList variant="line" aria-label="Корневая папка медиатеки">
        <TabsTrigger value="all-videos" disabled={busy}>
          <FileVideo size={16} /><span>Все видео</span>
        </TabsTrigger>
        {selectableFolders.map((folder) => (
          <TabsTrigger
            value={folder.id}
            key={folder.id}
            disabled={busy}
            title={folder.path || folder.name}
          >
            <Folder size={16} />
            <span>{folder.name}</span>
            <Badge variant="secondary">{folder.filesCount}</Badge>
          </TabsTrigger>
        ))}
        </TabsList>
      </Tabs>

      {root && subfolders.length > 0 && (
        <NativeSelect aria-label={`Вложенная папка: ${subfolderLabel}`} value={activeSubfolder?.id ?? ""} disabled={busy} onChange={event => selectSubfolder(event.target.value)}>
          <NativeSelectOption value="">Весь корень</NativeSelectOption>
          {subfolders.map(folder => <NativeSelectOption key={folder.id} value={folder.id}>{getSubfolderLabel(folder)}</NativeSelectOption>)}
        </NativeSelect>
      )}

      <div className="admin-file-controls">
        <label className="admin-video-search">
          <Search size={18} />
          <Input aria-label="Поиск файлов в медиатеке" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти файл или видео" />
        </label>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" aria-label="Сортировка медиатеки"><ArrowDownAZ size={18} />{sortField === "name" ? "По имени" : "По дате"}<ChevronDown size={16} /></Button></DropdownMenuTrigger>
          <DropdownMenuContent className="vault-menu dark" align="end"><DropdownMenuRadioGroup value={sortField} onValueChange={value => { setSortField(value as SortField); setSortDirection(value === "name" ? "asc" : "desc"); }}>
            <DropdownMenuRadioItem value="name">По имени</DropdownMenuRadioItem><DropdownMenuRadioItem value="date">По дате</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup></DropdownMenuContent>
        </DropdownMenu>
        <Button
          className="sort-direction admin-sort-direction"
          type="button"
          onClick={() => setSortDirection((current) => current === "asc" ? "desc" : "asc")}
          title={sortDirection === "asc" ? "По возрастанию" : "По убыванию"}
          aria-label={sortDirection === "asc" ? "По возрастанию" : "По убыванию"}
        >
          {sortDirection === "asc" ? <ArrowUp size={18} /> : <ArrowDown size={18} />}
        </Button>
        {folderId && <Button className="icon-button" type="button" onClick={() => void loadMedia()} disabled={busy} title="Обновить медиатеку">
          <RefreshCw className={loading ? "spin" : undefined} size={18} />
        </Button>}
      </div>

      <div className="admin-media-selection">
        <span aria-live="polite">Выбрано: {selectedEntries.length}</span>
        <Button variant="outline" className="ghost-button" type="button" disabled={busy || !mediaEntries.length}
          onClick={() => setSelectedKeys(current => new Set([...current, ...mediaEntries.map(adminMediaKey)]))}>
          Выделить результаты
        </Button>
        <Button variant="ghost" className="ghost-button" type="button" disabled={busy || !selectedEntries.length}
          onClick={() => setSelectedKeys(new Set())}>Снять выделение</Button>
        <Button variant="outline" className="ghost-button admin-media-remove" type="button" disabled={busy || !selectedEntries.length}
          onClick={() => void removeSelected()}>
          <Trash2 size={16} />{deletingSelection ? "Удаление…" : "Удалить выбранные"}
        </Button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {loading ? <p className="library-loading" role="status"><RefreshCw className="spin" size={18} />Загрузка медиатеки…</p> : mediaEntries.length === 0 ? (
        <div className="library-empty" role="status"><FileVideo size={28} /><h3>{error ? "Не удалось загрузить файлы" : query.trim() ? "Ничего не найдено" : "В этой папке нет файлов"}</h3><p>{error ? "Попробуйте обновить медиатеку." : query.trim() ? "Измените поисковый запрос или выберите другую папку." : "Добавленные файлы появятся после сканирования."}</p></div>
      ) : (
        <VirtualAdminMediaGrid
          entries={mediaEntries}
          scrollContainerRef={scrollContainerRef}
          updatingPosterId={updatingPosterId}
          deletingVideoId={deletingVideoId}
          deletingFileId={deletingFileId}
          disabled={busy}
          selectedKeys={selectedKeys}
          onToggleSelection={toggleSelection}
          onVideoChange={onVideoChange}
          onVideoDelete={(video) => void removeVideo(video)}
          onFileDelete={(file) => void removeFile(file)}
        />
      )}
    </section>
  );
}

type AdminMediaEntry = Exclude<FileBrowserEntry, { type: "folder" }>;

function adminMediaKey(entry: AdminMediaEntry) {
  return entry.type === "video" ? `video-${entry.video.id}` : `file-${entry.file.id}`;
}

function VirtualAdminMediaGrid({
  entries,
  scrollContainerRef,
  updatingPosterId,
  deletingVideoId,
  deletingFileId,
  disabled,
  selectedKeys,
  onToggleSelection,
  onVideoChange,
  onVideoDelete,
  onFileDelete
}: {
  entries: AdminMediaEntry[];
  scrollContainerRef: RefObject<HTMLElement | null>;
  updatingPosterId: string | null;
  deletingVideoId: string | null;
  deletingFileId: string | null;
  disabled: boolean;
  selectedKeys: ReadonlySet<string>;
  onToggleSelection: (key: string) => void;
  onVideoChange: (video: VideoFile, file: File) => void;
  onVideoDelete: (video: VideoFile) => void;
  onFileDelete: (file: SharedFile) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [metrics, setMetrics] = useState({ width: 0, scrollTop: 0, viewportHeight: 800, gridTop: 0 });

  const measure = useCallback(() => {
    const grid = gridRef.current;
    const scroller = scrollContainerRef.current;
    if (!grid || !scroller) return;

    const usesContainerScroll = /auto|scroll/.test(getComputedStyle(scroller).overflowY);
    const gridRect = grid.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const next = {
      width: grid.clientWidth,
      scrollTop: usesContainerScroll ? scroller.scrollTop : window.scrollY,
      viewportHeight: usesContainerScroll ? scroller.clientHeight : window.innerHeight,
      gridTop: usesContainerScroll
        ? gridRect.top - scrollerRect.top + scroller.scrollTop
        : gridRect.top + window.scrollY
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
    if (grid.parentElement) resizeObserver.observe(grid.parentElement);
    scroller.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    measure();

    return () => {
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [entries.length, measure, scrollContainerRef]);

  const compact = metrics.width <= 560;
  const gap = compact ? 10 : 14;
  const minimumColumnWidth = compact ? 240 : 260;
  const columns = Math.max(1, Math.floor((metrics.width + gap) / (minimumColumnWidth + gap)));
  const columnWidth = columns > 0 ? (metrics.width - gap * (columns - 1)) / columns : metrics.width;
  const cardHeight = columnWidth * 9 / 16 + 132;
  const rowHeight = cardHeight + gap;
  const rowCount = Math.ceil(entries.length / columns);
  const localScrollTop = Math.max(0, metrics.scrollTop - metrics.gridTop);
  const firstRow = Math.max(0, Math.min(rowCount - 1, Math.floor(localScrollTop / rowHeight) - 2));
  const lastRow = Math.min(rowCount, Math.ceil((localScrollTop + metrics.viewportHeight) / rowHeight) + 3);
  const firstIndex = firstRow * columns;
  const lastIndex = Math.min(entries.length, lastRow * columns);
  const totalHeight = Math.max(0, rowCount * rowHeight - gap);

  return (
    <div ref={gridRef} className="admin-media-virtual-grid" style={{ height: totalHeight }}>
      {entries.slice(firstIndex, lastIndex).map((entry, sliceIndex) => {
        const index = firstIndex + sliceIndex;
        const row = Math.floor(index / columns);
        const column = index % columns;
        const key = adminMediaKey(entry);
        const selected = selectedKeys.has(key);
        const title = entry.type === "video" ? entry.video.title : getFileDisplayName(entry.file);
        const subtitle = entry.type === "video" ? entry.video.folderName : [getFileExtension(entry.file), getFileDisplaySize(entry.file)].filter(Boolean).join(" · ");
        const details = <div className="poster-video-copy">
          <label className="media-card-selection" title={`Выделить ${title}`}>
            <Checkbox className="admin-media-select" aria-label={`Выделить ${title}`} checked={selected}
              disabled={disabled} onCheckedChange={() => onToggleSelection(key)} />
          </label>
          <div className="media-card-details"><strong title={title}>{title}</strong><span title={entry.type === "video" ? entry.video.path : entry.file.path}>{subtitle}</span></div>
        </div>;

        return (
          <div
            className={selected ? "admin-media-virtual-cell selected" : "admin-media-virtual-cell"}
            key={key}
            data-disabled={disabled || undefined}
            onClick={event => {
              if (disabled || event.defaultPrevented || !(event.target instanceof Element)) return;
              if (event.target.closest("button, a, input, label, [role='button'], [role='checkbox']")) return;
              if (window.getSelection()?.isCollapsed === false) return;
              onToggleSelection(key);
            }}
            style={{
              width: columnWidth,
              height: cardHeight,
              transform: `translate3d(${column * (columnWidth + gap)}px, ${row * rowHeight}px, 0)`
            }}
          >
            {entry.type === "video" ? (
              <AdminPosterRow
                video={entry.video}
                isUpdating={updatingPosterId === entry.video.id}
                isDeleting={deletingVideoId === entry.video.id}
                disabled={disabled}
                onChange={(file) => onVideoChange(entry.video, file)}
                onDelete={() => onVideoDelete(entry.video)}
                details={details}
              />
            ) : (
              <AdminFileTile
                file={entry.file}
                isDeleting={deletingFileId === entry.file.id}
                disabled={disabled}
                onDelete={() => onFileDelete(entry.file)}
                details={details}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function AdminFileTile({
  file,
  isDeleting,
  disabled,
  onDelete,
  details
}: {
  file: SharedFile;
  isDeleting: boolean;
  disabled: boolean;
  onDelete: () => void;
  details: ReactNode;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const image = isImageFile(file) && !previewFailed;
  const displayName = getFileDisplayName(file);
  const extension = getFileExtension(file);
  const extensionLabel = extension === "ФАЙЛ" ? extension : `.${extension}`;

  useEffect(() => setPreviewFailed(false), [file.id]);

  return (
    <article className="poster-video-card admin-media-file-card">
      <div className={image ? "admin-media-file-preview image" : "admin-media-file-preview"}>
        {image ? (
          <img
            src={getFileDownloadUrl(file.id)}
            alt=""
            loading="lazy"
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <span className="admin-media-file-type" aria-hidden="true">
            {isImageFile(file) ? <ImageIcon size={42} /> : <FileIcon size={42} />}
            <b>{extensionLabel}</b>
          </span>
        )}
      </div>
      {details}
      <div className="media-card-actions">
        <Button variant="outline" asChild className="media-card-main-action"><a href={getFileDownloadUrl(file.id)} download aria-label={`Скачать ${displayName}`}><Download size={16} />Скачать файл</a></Button>
        <Button type="button" variant="ghost" size="icon" className="media-card-delete" onClick={onDelete} disabled={disabled} title="Удалить файл" aria-label={`Удалить файл ${displayName}`}>
          {isDeleting ? <RefreshCw className="spin" size={16} /> : <Trash2 size={16} />}
        </Button>
      </div>
    </article>
  );
}

function AdminPosterRow({
  video,
  isUpdating,
  isDeleting,
  disabled,
  onChange,
  onDelete,
  details
}: {
  video: VideoFile;
  isUpdating: boolean;
  isDeleting: boolean;
  disabled: boolean;
  onChange: (file: File) => void;
  onDelete: () => void;
  details: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <article className="poster-video-card">
      <div className="poster-preview-button">
        <PosterImage video={video} />
      </div>
      {details}
      <div className="media-card-actions">
        <Button type="button" variant="outline" className="media-card-main-action" onClick={() => inputRef.current?.click()} disabled={disabled} aria-label={isUpdating ? `Загрузка постера ${video.title}` : `Сменить постер ${video.title}`}>
          {isUpdating ? <RefreshCw className="spin" size={16} /> : <ImagePlus size={16} />}{isUpdating ? "Загрузка…" : "Сменить постер"}
        </Button>
        <Button type="button" variant="ghost" size="icon" className="media-card-delete" onClick={onDelete} disabled={disabled} title="Удалить видео" aria-label={`Удалить видео ${video.title}`}>
          {isDeleting ? <RefreshCw className="spin" size={16} /> : <Trash2 size={16} />}
        </Button>
      </div>
      <Input
        ref={inputRef}
        className="admin-poster-input"
        hidden
        tabIndex={-1}
        type="file"
        disabled={disabled}
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
          <Input
            aria-label={`Название папки ${folder.name}`}
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
            <Button className="icon-button" onClick={onSaveEdit} disabled={isUpdating} title="Сохранить">
              <Save size={18} />
            </Button>
            <Button className="icon-button" onClick={onCancelEdit} disabled={isUpdating} title="Отменить">
              <X size={18} />
            </Button>
          </>
        ) : (
          <Button className="icon-button" onClick={onStartEdit} disabled={isBusy || isUpdating} title="Редактировать">
            <Pencil size={18} />
          </Button>
        )}
      </div>

      <div className="folder-meta">
        <span>{folder.filesCount} файлов</span>
        <span>{folder.lastScanAt}</span>
      </div>
      <Button className="icon-button" onClick={onRescan} disabled={isBusy || isRescanning} title="Пересканировать">
        <RefreshCw className={isRescanning ? "spin" : undefined} size={18} />
      </Button>
      <Switch aria-label={`Доступ к папке ${folder.name}`} checked={folder.enabled} onCheckedChange={onToggleEnabled} disabled={isBusy || isUpdating} />
      <Button className="danger-button" onClick={onDelete} disabled={isBusy || isUpdating} title="Удалить путь">
        <Trash2 size={18} />
      </Button>
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
    <DialogPrimitive.Root open onOpenChange={open => { if (!open) onClose(); }}><DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="modal-backdrop theme-classic library-folder-overlay">
      <DialogPrimitive.Content className="folder-picker" onPointerDownOutside={event => event.preventDefault()}>
        <header className="modal-header">
          <div>
            <DialogPrimitive.Title asChild><h2>Выбор папки</h2></DialogPrimitive.Title>
            <DialogPrimitive.Description asChild><span>{selectedPath || "Компьютер"}</span></DialogPrimitive.Description>
          </div>
          <Button className="icon-button" onClick={onClose} title="Закрыть">
            <X size={18} />
          </Button>
        </header>

        <div className="folder-picker-toolbar">
          <Button className="ghost-button" onClick={() => setCurrentPath(browseState?.parent || "")} disabled={!selectedPath}>
            <ArrowUp size={18} />
            <span>Выше</span>
          </Button>
          <Button className="primary-button" onClick={() => onSelect(selectedPath)} disabled={!selectedPath}>
            <FolderPlus size={18} />
            <span>Выбрать</span>
          </Button>
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
      </DialogPrimitive.Content>
    </DialogPrimitive.Overlay></DialogPrimitive.Portal></DialogPrimitive.Root>
  );
}

function FolderPickerRow({ entry, onOpen }: { entry: ServerFolderEntry; onOpen: () => void }) {
  const Icon = entry.isRoot ? HardDrive : Folder;

  return (
    <Button className="folder-picker-row" onClick={onOpen}>
      <Icon size={20} />
      <span>{entry.name}</span>
      <small>{entry.path}</small>
      <ChevronRight size={18} />
    </Button>
  );
}

export default App;

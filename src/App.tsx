import { VideoProblemBadge, VideoProblemControl } from "./VideoProblem";
import {
  TVCardNowPlayingBadge,
  TVCastCardControls,
  TVCastModal,
  TVFloatingDock,
  TVPlayerButton,
  TVStatusPill,
  VaultLiveToast,
  audioFileToTVQueueItem,
  isAudioSharedFile,
  useVaultWebSocket,
  videoToTVQueueItem
} from "./TVRemote";
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
import { AccountAuthStatus, AdminUsersPanel, AuthForm, PasswordForm, isAdministrator } from "./Accounts";
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
  Clock3,
  ChevronRight,
  Download,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode2,
  FileSpreadsheet,
  FileText,
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
  Palette,
  Pencil,
  Play,
  Presentation,
  SkipBack,
  SkipForward,
  RefreshCw,
  Save,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  LogIn,
  Smartphone,
  Monitor,
  Trash2,
  UserRound,
  Users,
  X
} from "lucide-react";
import {
  addFolder,
  authExpiredEvent,
  browseServerFolders,
  deleteFolder,
  deleteMediaFile,
  deleteMediaVideo,
  getAccounts,
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
  CmdOpenOnTV,
  FileBrowserEntry,
  Folder as VaultFolder,
  Page,
  ServerFolderBrowseResponse,
  ServerFolderEntry,
  SharedFile,
  TVDevice,
  TVQueueItem,
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
  cacheMode: RequestCache;
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
}> = [];
let activePosterPreviewLoads = 0;

async function createPosterPreview(url: string, cacheMode: RequestCache = "force-cache") {
  const response = await fetch(url, { cache: cacheMode });
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
    void createPosterPreview(item.url, item.cacheMode)
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

function loadPosterPreview(url: string, cacheMode: RequestCache = "force-cache") {
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
  posterPreviewQueue.unshift({ url, cacheMode, resolve: resolveRequest, reject: rejectRequest });
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
  loginFromFiles: boolean;
  playerFromVideos: boolean;
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
    loginFromFiles: page === "login" && params.get("from") === "files",
    playerFromVideos: page === "player" && params.get("from") === "videos",
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
  const playerReturnPageRef = useRef<Page>(initialRouteState.playerFromVideos ? "videos" : "files");
  const returnScrollTopRef = useRef(0);
  const pendingScrollRestoreRef = useRef<number | null>(null);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [fileEntries, setFileEntries] = useState<FileBrowserEntry[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(initialRouteState.currentFolderId);
  const [page, setPage] = useState<Page>(initialRouteState.page);
  const [loginFromFiles, setLoginFromFiles] = useState(initialRouteState.loginFromFiles);
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
  const [playlistCollapsed, setPlaylistCollapsed] = useState(false);
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

  const routeSearch = useMemo(() => {
    const params = new URLSearchParams();

    if (page !== "videos") {
      params.set("page", page);
    }
    if (page === "login" && loginFromFiles) {
      params.set("from", "files");
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
    if ((page === "files" || (page === "login" && loginFromFiles) ||
      (page === "player" && playerReturnPageRef.current === "files")) && fileTypeFilter !== "videos") {
      params.set("type", fileTypeFilter);
    }
    if (page === "player") {
      if (playerReturnPageRef.current === "videos") {
        params.set("from", "videos");
      }
      const videoId = selectedVideo?.id ?? activeVideoId;
      if (videoId) {
        params.set("video", videoId);
      }
    }

    return params.toString();
  }, [activeVideoId, currentFolderId, fileTypeFilter, loginFromFiles, page, query, selectedFolder, selectedVideo, sortDirection, sortField, viewMode]);

  useEffect(() => {
    const nextUrl = `${window.location.pathname}${routeSearch ? `?${routeSearch}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, [routeSearch]);

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

  const loginReturnPage = useRef<Page>(initialRouteState.loginFromFiles ? "files" : "videos");
  const settingsReturnPageRef = useRef<Page>("videos");
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>(() => {
    if (initialRouteState.page === "admin") return "users";
    try {
      const saved = sessionStorage.getItem(settingsSectionStorageKey) as SettingsSectionId | null;
      if (saved === "appearance" || saved === "account" || saved === "folders" || saved === "media" || saved === "users") {
        return saved;
      }
    } catch {
      // Ignore storage errors.
    }
    return "appearance";
  });
  const [pendingAccountCount, setPendingAccountCount] = useState(0);

  const activeSettingsSection: SettingsSectionId =
    !isAdminSession && (settingsSection === "folders" || settingsSection === "media" || settingsSection === "users")
      ? "account"
      : settingsSection;

  useEffect(() => {
    try {
      sessionStorage.setItem(settingsSectionStorageKey, activeSettingsSection);
    } catch {
      // Ignore storage errors.
    }
  }, [activeSettingsSection]);

  useEffect(() => {
    if (!isAdminSession) {
      setPendingAccountCount(0);
      return;
    }
    let cancelled = false;
    void getAccounts()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) {
          setPendingAccountCount(list.filter((item) => item.status === "pending").length);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAdminSession]);

  const openPage = (nextPage: Page) => {
    const destination = nextPage === "admin" && !session ? "login" : nextPage;
    if (destination === "login" && page !== "login" && page !== "admin") loginReturnPage.current = page;
    if ((destination === "settings" || destination === "admin") && (page === "videos" || page === "files")) {
      settingsReturnPageRef.current = page;
    }
    if (destination === "admin") {
      setSettingsSection("users");
    }
    setLoginFromFiles(destination === "login" && page === "files");
    setPage(destination);
    setSelectedVideo(null);
    if (nextPage !== "player") {
      setActiveVideoId(null);
    }
    scrollToTop();
  };

  const openSettings = (targetSection?: SettingsSectionId) => {
    if (targetSection) {
      setSettingsSection(targetSection);
    }
    openPage("settings");
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
    openPage(loginFromFiles ? "files" : "settings");
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

  const [tvCastModal, setTvCastModal] = useState<{ open: boolean; focusItem: TVQueueItem | null; fromPlayer?: boolean }>({
    open: false,
    focusItem: null
  });
  const [tvDockCollapsed, setTvDockCollapsed] = useState(false);

  const livePosterTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const timers = livePosterTimersRef.current;
    return () => {
      for (const timerId of timers.values()) {
        window.clearTimeout(timerId);
      }
      timers.clear();
    };
  }, []);

  const applyVideoPosterRevision = useCallback((videoId: string, posterRevision: number) => {
    setVideos((current) =>
      current.map((item) => (item.id === videoId ? { ...item, posterRevision } : item))
    );
    setFileEntries((current) =>
      current.map((item) =>
        item.type === "video" && item.video.id === videoId
          ? { ...item, video: { ...item.video, posterRevision } }
          : item
      )
    );
    setSelectedVideo((current) =>
      current && current.id === videoId ? { ...current, posterRevision } : current
    );
  }, []);

  const prefetchLiveVideoPoster = useCallback((videoId: string, initialRevision: number) => {
    const retryDelaysMs = [2000, 3000, 5000, 8000, 12000, 15000];
    const existingTimer = livePosterTimersRef.current.get(videoId);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
      livePosterTimersRef.current.delete(videoId);
    }

    const attemptFetch = (revision: number, retryIndex: number) => {
      const posterUrl = getVideoPosterUrl(videoId, revision);
      void loadPosterPreview(posterUrl, "no-store")
        .then(() => {
          livePosterTimersRef.current.delete(videoId);
          if (retryIndex > 0) {
            applyVideoPosterRevision(videoId, revision);
          }
        })
        .catch(() => {
          const delay = retryDelaysMs[retryIndex];
          if (delay === undefined) {
            livePosterTimersRef.current.delete(videoId);
            return;
          }
          const timerId = window.setTimeout(() => {
            livePosterTimersRef.current.delete(videoId);
            attemptFetch(Date.now(), retryIndex + 1);
          }, delay);
          livePosterTimersRef.current.set(videoId, timerId);
        });
    };

    attemptFetch(initialRevision, 0);
  }, [applyVideoPosterRevision]);

  const handleLiveLibraryEntry = useCallback((entry: FileBrowserEntry) => {
    if (entry.type === "video") {
      const nextVideo = withFreshPoster(entry.video);
      const nextEntry: FileBrowserEntry = { type: "video", video: nextVideo };
      setVideos((current) =>
        current.some((item) => item.id === nextVideo.id)
          ? current.map((item) => (item.id === nextVideo.id ? nextVideo : item))
          : [nextVideo, ...current]
      );
      if (currentFolderId === nextVideo.parentFolderId) {
        setFileEntries((current) =>
          current.some((item) => item.type === "video" && item.video.id === nextVideo.id)
            ? current.map((item) => (item.type === "video" && item.video.id === nextVideo.id ? nextEntry : item))
            : [nextEntry, ...current]
        );
      }
      if (nextVideo.posterRevision) {
        prefetchLiveVideoPoster(nextVideo.id, nextVideo.posterRevision);
      }
      void getFolders().then(setFolders).catch(() => {});
      return;
    }

    if (entry.type === "file") {
      const nextFile = entry.file;
      if (currentFolderId === nextFile.parentFolderId) {
        setFileEntries((current) =>
          current.some((item) => item.type === "file" && item.file.id === nextFile.id)
            ? current.map((item) => (item.type === "file" && item.file.id === nextFile.id ? entry : item))
            : [entry, ...current]
        );
      }
      void getFolders().then(setFolders).catch(() => {});
      return;
    }

    if (entry.type === "folder") {
      const nextFolder = entry.folder;
      setFolders((current) =>
        current.some((item) => item.id === nextFolder.id)
          ? current.map((item) => (item.id === nextFolder.id ? nextFolder : item))
          : [nextFolder, ...current]
      );
      if (currentFolderId === nextFolder.parentId || (currentFolderId === null && nextFolder.isRoot)) {
        setFileEntries((current) =>
          current.some((item) => item.type === "folder" && item.folder.id === nextFolder.id)
            ? current.map((item) => (item.type === "folder" && item.folder.id === nextFolder.id ? entry : item))
            : [entry, ...current]
        );
      }
    }
  }, [currentFolderId, prefetchLiveVideoPoster]);

  const handleLiveLibraryDelete = useCallback((entry: FileBrowserEntry) => {
    if (entry.type === "video") {
      const deletedVideoId = entry.video.id;
      const pendingTimer = livePosterTimersRef.current.get(deletedVideoId);
      if (pendingTimer !== undefined) {
        window.clearTimeout(pendingTimer);
        livePosterTimersRef.current.delete(deletedVideoId);
      }
      setVideos((current) => current.filter((item) => item.id !== deletedVideoId));
      setFileEntries((current) => current.filter((item) => item.type !== "video" || item.video.id !== deletedVideoId));
      setPlayerQueue((current) => current.filter((item) => item.id !== deletedVideoId));
      setSelectedVideo((current) => (current?.id === deletedVideoId ? null : current));
      setActiveVideoId((current) => (current === deletedVideoId ? null : current));
      if (page === "player" && (selectedVideo?.id === deletedVideoId || activeVideoId === deletedVideoId)) {
        closePlayer();
      }
      void getFolders().then(setFolders).catch(() => {});
      return;
    }

    if (entry.type === "file") {
      const deletedFileId = entry.file.id;
      setFileEntries((current) => current.filter((item) => item.type !== "file" || item.file.id !== deletedFileId));
      void getFolders().then(setFolders).catch(() => {});
      return;
    }

    if (entry.type === "folder") {
      const deletedFolderId = entry.folder.id;
      setFolders((current) => current.filter((item) => item.id !== deletedFolderId));
      setFileEntries((current) => current.filter((item) => item.type !== "folder" || item.folder.id !== deletedFolderId));
      if (selectedFolder === deletedFolderId) {
        setSelectedFolder("all");
      }
      if (currentFolderId === deletedFolderId) {
        setCurrentFolderId(null);
      }
    }
  }, [activeVideoId, currentFolderId, page, selectedFolder, selectedVideo]);

  const handleLiveLibraryRefresh = useCallback(() => {
    void refreshData();
    void getFolderEntries(currentFolderId).then(setFileEntries).catch(() => {});
  }, [currentFolderId, refreshData]);

  const handleRemoteOpen = useCallback((cmd: CmdOpenOnTV) => {
    if (cmd.mode === "stop") {
      setPlayerQueue([]);
      if (page === "player") {
        closePlayer();
      }
      return;
    }

    const videoEntries = (cmd.entries ?? []).filter((entry) => entry.type === "video" || !entry.type);
    if (videoEntries.length === 0) {
      if (cmd.mode === "sync") {
        setPlayerQueue([]);
        if (page === "player") closePlayer();
      }
      return;
    }

    const catalog = new Map(videos.map((item) => [item.id, item]));
    void Promise.all(
      videoEntries.map(async (entry) => {
        const found = catalog.get(entry.id);
        if (found) return found;
        try {
          return await getVideo(entry.id);
        } catch {
          return null;
        }
      })
    ).then((resolved) => {
      const resolvedVideos = resolved.filter((item): item is VideoFile => item !== null);
      if (resolvedVideos.length === 0) return;

      if (cmd.mode === "append") {
        setPlayerQueue((current) => {
          const existingIds = new Set(current.map((item) => item.id));
          const additions = resolvedVideos.filter((item) => !existingIds.has(item.id));
          return [...current, ...additions];
        });
        if (page !== "player") {
          setSelectedVideo(resolvedVideos[0]);
          setActiveVideoId(resolvedVideos[0].id);
          setPage("player");
        }
        return;
      }

      if (cmd.mode === "sync") {
        if (page === "player" && selectedVideo && !resolvedVideos.some((item) => item.id === selectedVideo.id)) {
          // Preserve currently playing local video and put the synced queue right after it
          setPlayerQueue([selectedVideo, ...resolvedVideos]);
          return;
        }
        setPlayerQueue(resolvedVideos);
        return;
      }

      // Default: "replace" — replace queue and start playing from the first item
      setPlayerQueue(resolvedVideos);
      setSelectedVideo(resolvedVideos[0]);
      setActiveVideoId(resolvedVideos[0].id);
      setPage("player");
      scrollToTop();
    });
  }, [page, selectedVideo, videos]);

  const {
    tvDevices,
    connectedTv,
    activeTargetTv,
    tvQueue,
    activeQueueItemId,
    tvNowPlaying,
    tvNowPlayingByDevice,
    isSyncedWithTv,
    wsConnected,
    toast,
    selectTvDevice,
    playItemsOnTV,
    playFromQueueIndex,
    syncQueueToTV,
    stopOnTV,
    disconnectFromTV,
    addItemToQueue,
    removeItemFromQueue,
    toggleItemInQueue,
    moveQueueItem,
    clearQueue,
    reportCurrentPlaybackOnTV
  } = useVaultWebSocket({
    videos,
    onLibraryEntry: handleLiveLibraryEntry,
    onLibraryDelete: handleLiveLibraryDelete,
    onLibraryRefresh: handleLiveLibraryRefresh,
    onOpenFromRemote: handleRemoteOpen
  });

  useEffect(() => {
    if (page === "player" && selectedVideo) {
      reportCurrentPlaybackOnTV(selectedVideo, "playing", playerQueue.length > 0 ? "remote" : "local");
    } else {
      reportCurrentPlaybackOnTV(null, "stopped");
    }
  }, [page, playerQueue.length, reportCurrentPlaybackOnTV, selectedVideo]);

  const tvQueueIdSet = useMemo(() => new Set(tvQueue.map((item) => item.id)), [tvQueue]);

  const browsePage = page === "player" ? playerReturnPageRef.current : page;
  const getVideoHref = (videoId: string) => {
    const params = new URLSearchParams(routeSearch);
    params.set("page", "player");
    params.set("video", videoId);
    if (browsePage === "videos") params.set("from", "videos");
    return `?${params}${window.location.hash}`;
  };
  const pageTitle = browsePage === "files" ? "Все файлы" : "Видеотека";
  const pageEyebrow = browsePage === "files" ? "Проводник" : "VIDEO VAULT / AFTER DARK";
  const playerPlaylist = useMemo(() => {
    const queue = playerQueue.length ? playerQueue : filteredVideos;
    const catalog = new Map(videos.map(item => [item.id, item]));
    const items = queue.map(item => catalog.get(item.id) ?? item);
    return selectedVideo && !items.some(item => item.id === selectedVideo.id) ? [selectedVideo, ...items] : items;
  }, [playerQueue, filteredVideos, videos, selectedVideo]);

  if (page === "login" || (page === "admin" && !session)) {
    return <div className="theme-classic dark harbor-page">
      <header className="harbor-nav"><strong><MonitorPlay size={23} /> Video Vault</strong>
        <Button type="button" className="harbor-back" variant="ghost" onClick={() => openPage(loginReturnPage.current)}><ArrowLeft size={17} aria-hidden="true" />Назад</Button>
      </header>
      <div className="harbor-sky" aria-hidden="true">
        <svg viewBox="0 0 1440 240" preserveAspectRatio="xMidYMin meet" fill="none" focusable="false">
          <defs>
            <linearGradient id="harbor-sky-canopy" x1="720" y1="0" x2="720" y2="190" gradientUnits="userSpaceOnUse">
              <stop stopColor="#1b2929" stopOpacity=".85"/>
              <stop offset=".6" stopColor="#203030" stopOpacity=".45"/>
              <stop offset="1" stopColor="#191e1e" stopOpacity="0"/>
            </linearGradient>
            <radialGradient id="harbor-moon-glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1110 98) rotate(90) scale(125 165)">
              <stop stopColor="#ffcb80" stopOpacity=".2"/>
              <stop offset=".55" stopColor="#ffd598" stopOpacity=".06"/>
              <stop offset="1" stopColor="#ffd598" stopOpacity="0"/>
            </radialGradient>
            <linearGradient id="harbor-sky-aurora" x1="160" y1="16" x2="1260" y2="190" gradientUnits="userSpaceOnUse">
              <stop stopColor="#2f4746" stopOpacity=".42"/>
              <stop offset=".5" stopColor="#3d5856" stopOpacity=".22"/>
              <stop offset="1" stopColor="#283c3b" stopOpacity=".35"/>
            </linearGradient>
            <symbol id="harbor-star-glint" viewBox="-12 -12 24 24">
              <path d="m0-11 2.4 8.6L11 0 2.4 2.4 0 11l-2.4-8.6L-11 0l8.6-2.4Z" fill="#ffd598"/>
            </symbol>
            <symbol id="harbor-gull" viewBox="0 0 56 26">
              <path d="M2 16Q15 3 28 13Q41 2 54 12Q40 9 28 19Q16 10 2 16Z" fill="#efd9b2"/>
              <path d="M28 13Q41 2 54 12Q40 9 28 19Z" fill="#c8b599"/>
              <path d="M2 16Q8 10 13 11L9 15ZM54 12Q48 7 43 9L47 12Z" fill="#bd6c50"/>
            </symbol>
          </defs>
          {/* Smooth night sky wave layers */}
          <path d="M0 0H1440V182Q1310 144 1164 162T870 118Q720 82 564 118T264 160Q126 178 0 152Z" fill="url(#harbor-sky-canopy)"/>
          <path d="M0 68Q180 34 368 64T736 58Q930 26 1126 60T1440 48V118Q1268 92 1094 108T734 90Q538 72 346 102T0 110Z" fill="url(#harbor-sky-aurora)"/>
          {/* Soft moonlight halo */}
          <ellipse cx="1110" cy="98" rx="165" ry="125" fill="url(#harbor-moon-glow)"/>
          <circle cx="1110" cy="98" r="72" fill="#ffd598" opacity=".06"/>
          <circle cx="1110" cy="98" r="52" fill="#ffd598" opacity=".11"/>
          {/* Crisp flat starfield and nautical constellations */}
          <g stroke="#cbb58b" strokeOpacity=".32" strokeWidth="1.2" strokeDasharray="3 4">
            <path d="M412 52 458 36 504 54 542 40"/>
            <path d="M862 44 906 30 948 50 982 32"/>
          </g>
          <g fill="#dfd4b8">
            <circle cx="74" cy="42" r="1.6" opacity=".6"/><circle cx="298" cy="48" r="2" opacity=".8"/>
            <circle cx="356" cy="78" r="1.5" opacity=".55"/><circle cx="412" cy="52" r="2.1"/>
            <circle cx="458" cy="36" r="1.8"/><circle cx="504" cy="54" r="2.2"/><circle cx="542" cy="40" r="1.7"/>
            <circle cx="792" cy="58" r="1.8" opacity=".75"/><circle cx="862" cy="44" r="2"/>
            <circle cx="906" cy="30" r="2.2"/><circle cx="948" cy="50" r="1.8"/><circle cx="982" cy="32" r="2"/>
            <circle cx="1268" cy="44" r="2" opacity=".85"/><circle cx="1358" cy="68" r="1.6" opacity=".65"/>
            <circle cx="1396" cy="38" r="2" opacity=".8"/>
          </g>
          <use href="#harbor-star-glint" x="234" y="34" width="17" height="17" opacity=".85"/>
          <use href="#harbor-star-glint" x="576" y="24" width="15" height="15" opacity=".75"/>
          <use href="#harbor-star-glint" x="812" y="26" width="16" height="16" opacity=".8"/>
          <use href="#harbor-star-glint" x="1008" y="42" width="18" height="18" opacity=".9"/>
          <use href="#harbor-star-glint" x="1302" y="32" width="17" height="17" opacity=".85"/>
          {/* Cloud 1: Upper-left cloud (compact and well-spaced) */}
          <g>
            <path d="M72 134c-15 0-26-8-26-18 0-9 9-16 21-17 6-13 21-20 39-19 12-13 33-17 50-7 8 4 14 10 17 18 13-3 28 2 34 11 12 1 20 8 19 17-2 9-13 15-28 15H72Z" fill="#283938"/>
            <path d="M102 140c-12 0-20-6-20-14 0-7 7-13 17-14 5-10 17-16 31-14 10-10 27-13 41-6 6 3 11 8 14 14 11-3 22 1 27 9 9 1 16 6 15 13-1 7-11 12-22 12H102Z" fill="#364b49"/>
          </g>
          {/* Cloud 2: High center cloud above the auth form */}
          <g>
            <path d="M618 96c-12 0-21-6-21-14 0-7 7-13 17-14 5-10 17-16 31-14 10-10 27-13 40-5 6 3 11 8 14 14 11-3 22 1 27 8 9 1 16 6 15 13-1 7-11 12-22 12H618Z" fill="#283938"/>
            <path d="M644 102c-9 0-16-5-16-11 0-6 6-10 13-11 4-8 13-12 24-11 8-8 21-10 32-4 5 2 9 6 11 11 8-2 17 1 21 7 7 1 12 5 11 10-1 6-8 8-17 8H644Z" fill="#364b49"/>
          </g>
          {/* Flat-styled Moon aligned with water reflection at x=1110 */}
          <g>
            <circle className="harbor-moon" cx="1110" cy="98" r="38" fill="#ffd598"/>
            <path d="M1094 64a38 38 0 0 0-21 48 36 36 0 0 1 46-44 38 38 0 0 0-25-4Z" fill="#fff0bd" opacity=".65"/>
            <circle cx="1123" cy="86" r="6.5" fill="#e5b573" opacity=".45"/>
            <circle cx="1114" cy="108" r="9.5" fill="#e5b573" opacity=".35"/>
            <circle cx="1131" cy="106" r="4.2" fill="#e5b573" opacity=".4"/>
          </g>
          {/* Cloud 3: Sleek cloud softly overlapping lower-right of the Moon */}
          <g>
            <path d="M1082 148c-14 0-25-8-25-17 0-9 9-15 20-16 6-12 20-19 37-18 11-12 31-16 48-7 7 4 13 10 16 17 13-3 26 2 32 10 11 1 19 8 18 16-2 9-13 15-26 15H1082Z" fill="#283938"/>
            <path d="M1112 154c-11 0-19-6-19-13 0-7 7-12 16-13 5-9 16-15 29-13 9-10 25-12 38-5 6 3 10 8 13 13 10-2 21 1 25 8 9 1 15 6 14 12-1 6-10 11-21 11H1112Z" fill="#364b49"/>
          </g>
          {/* High gull & subtle breeze stripes */}
          <use href="#harbor-gull" x="372" y="96" width="34" height="16" opacity=".82"/>
          <g stroke="#85a49a" strokeWidth="2" strokeLinecap="round" opacity=".65">
            <path d="M84 152h52m12 0h16M636 112h44M1086 166h56m14 0h18"/>
          </g>
        </svg>
      </div>
      <main className="harbor-main">
        {/* Left middle sky: open starry space with soaring gulls above and one lower cloud on the far left */}
        <svg className="harbor-wind" viewBox="0 0 460 320" aria-hidden="true" focusable="false" fill="none">
          <g fill="#dfd4b8">
            <circle cx="64" cy="44" r="1.8" opacity=".7"/><circle cx="168" cy="28" r="2" opacity=".8"/>
            <circle cx="288" cy="52" r="1.6" opacity=".6"/><circle cx="88" cy="142" r="1.8" opacity=".7"/>
            <circle cx="348" cy="196" r="1.5" opacity=".55"/>
          </g>
          <path d="m136 58 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z" fill="#ffd598" opacity=".85"/>
          {/* Soaring two-tone coastal seabirds in open sky */}
          <path d="M118 118Q184 104 252 116T368 108" stroke="#486663" strokeWidth="2.2" strokeLinecap="round" opacity=".85"/>
          <path d="M148 132Q214 120 278 130T384 122" stroke="#85a49a" strokeWidth="1.8" strokeLinecap="round" opacity=".7"/>
          <g transform="translate(224 82)">
            <path d="M0 24Q20 4 42 19Q64 2 84 17Q62 13 42 28Q22 15 0 24Z" fill="#efd9b2"/>
            <path d="M42 19Q64 2 84 17Q62 13 42 28Z" fill="#c8b599"/>
            <path d="M0 24Q9 15 17 16L11 22ZM84 17Q75 10 67 12L73 17Z" fill="#db896b"/>
            <path d="M38 18 42 28 46 19Z" fill="#bd6c50"/>
          </g>
          <g transform="translate(308 54) scale(.74)">
            <path d="M0 24Q20 4 42 19Q64 2 84 17Q62 13 42 28Q22 15 0 24Z" fill="#efd9b2"/>
            <path d="M42 19Q64 2 84 17Q62 13 42 28Z" fill="#c8b599"/>
            <path d="M0 24Q9 15 17 16L11 22ZM84 17Q75 10 67 12L73 17Z" fill="#bd6c50"/>
          </g>
          {/* Cloud 4: Single lower-left cloud bank well separated from the upper sky */}
          <g>
            <path d="M48 238c-15 0-26-8-26-18 0-9 9-16 20-17 6-13 20-20 38-18 12-13 33-17 50-7 8 4 14 10 17 17 13-3 27 2 33 11 11 1 20 8 18 16-2 9-13 16-27 16H48Z" fill="#283938"/>
            <path d="M76 244c-12 0-21-6-21-14 0-7 7-13 17-14 5-10 16-16 30-14 10-10 26-13 40-5 6 3 11 8 14 14 10-3 22 1 26 8 9 1 16 6 15 13-1 7-10 12-21 12H76Z" fill="#364b49"/>
          </g>
          <path d="M58 256h64m14 0h20" stroke="#85a49a" strokeWidth="2" strokeLinecap="round" opacity=".68"/>
        </svg>
        <AuthForm onLogin={handleLogin} />
        {/* Right middle sky: vintage hot-air balloon in clear starry sky & one lower-right cloud */}
        <svg className="harbor-chart" viewBox="0 0 460 320" aria-hidden="true" focusable="false" fill="none">
          <defs>
            <radialGradient id="harbor-balloon-glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(168 118) scale(86)">
              <stop stopColor="#ffc877" stopOpacity=".28"/>
              <stop offset="1" stopColor="#ffc877" stopOpacity="0"/>
            </radialGradient>
          </defs>
          {/* Starfield and shooting star */}
          <path d="M284 52 354 24" stroke="#ffd598" strokeWidth="1.6" strokeLinecap="round" opacity=".55"/>
          <path d="m284 52 2.2 6.8 6.8 2.2-6.8 2.2-2.2 6.8-2.2-6.8-6.8-2.2 6.8-2.2Z" fill="#ffd598"/>
          <path d="m382 88 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#e9c58b" opacity=".85"/>
          <g fill="#dfd4b8">
            <circle cx="64" cy="68" r="1.7" opacity=".65"/><circle cx="248" cy="34" r="1.8" opacity=".7"/>
            <circle cx="408" cy="48" r="2" opacity=".8"/><circle cx="342" cy="134" r="1.6" opacity=".6"/>
            <circle cx="96" cy="248" r="1.7" opacity=".65"/>
          </g>
          {/* Distant warm harbor sky-lantern */}
          <g transform="translate(62 146)">
            <circle cx="12" cy="14" r="18" fill="#ffc877" opacity=".18"/>
            <path d="M5 10c0-6 4-10 7-10s7 4 7 10l-2 9H7Z" fill="#bd6c50"/>
            <path d="M8 1c2-1 6-1 8 0l-1 18H9Z" fill="#efd6ac"/>
            <rect x="8" y="19" width="8" height="3" rx="1" fill="#ffc877"/>
            <circle cx="12" cy="20.5" r="2" fill="#fff0bd"/>
          </g>
          {/* Main flat-styled Vintage Harbor Hot-Air Balloon in open sky with warm burner glow */}
          <circle cx="168" cy="118" r="86" fill="url(#harbor-balloon-glow)"/>
          <g transform="translate(128 58)">
            <path d="M40 0C16 0 0 19 0 41c0 17 12 31 24 46l5 10h22l5-10C68 72 80 58 80 41 80 19 64 0 40 0Z" fill="#bd6c50"/>
            <path d="M40 0C25 0 14 19 14 41c0 17 8 31 17 46l3 10h12l3-10c9-15 17-29 17-46C66 19 55 0 40 0Z" fill="#efd6ac"/>
            <path d="M40 0c-6 0-11 19-11 41 0 17 3 31 7 46l1 10h6l1-10c4-15 7-29 7-46C51 19 46 0 40 0Z" fill="#293532"/>
            <path d="M2 34h76c1 5 1 10 0 14H2c-1-4-1-9 0-14Z" fill="#db896b"/>
            <path d="M15 34h50v14H15Z" fill="#f1b761"/>
            <path d="M29 34h22v14H29Z" fill="#bd6c50"/>
            <path d="M40 0c24 0 40 19 40 41 0 17-12 31-24 46l-5 10H40V0Z" fill="#654934" opacity=".22"/>
            <rect x="27" y="96" width="26" height="4" rx="1.5" fill="#965d46"/>
            <path d="M35 100v12m10-12v12" stroke="#987d68" strokeWidth="1.6"/>
            <circle cx="40" cy="105" r="7" fill="#ffc877" opacity=".45"/>
            <path d="m40 100 3.5 5-3.5 5-3.5-5Z" fill="#fff0bd"/>
            <path d="M31 111h18l-2 12H33Z" fill="#87664f"/>
            <path d="M30 110h20v3H30Z" fill="#d5b590"/>
            <path d="M40 111h9l-2 12h-7Z" fill="#414442" opacity=".45"/>
          </g>
          {/* Cloud 5: Single lower-right cloud bank offset below and to the right of the balloon */}
          <g>
            <path d="M242 246c-15 0-26-8-26-18 0-9 9-16 20-17 6-13 20-20 38-18 12-13 33-17 50-7 8 4 14 10 17 17 13-3 27 2 33 11 11 1 20 8 18 16-2 9-13 16-27 16H242Z" fill="#283938"/>
            <path d="M270 252c-12 0-21-6-21-14 0-7 7-13 17-14 5-10 16-16 30-14 10-10 26-13 40-5 6 3 11 8 14 14 10-3 22 1 26 8 9 1 16 6 15 13-1 7-10 12-21 12H270Z" fill="#364b49"/>
          </g>
          <path d="M256 264h68m14 0h20" stroke="#85a49a" strokeWidth="2" strokeLinecap="round" opacity=".68"/>
        </svg>
      </main>
      <svg className="harbor-scene" viewBox="0 0 1440 270" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
        <defs><linearGradient id="harbor-lantern"><stop stopColor="#ffcb80" stopOpacity=".26"/><stop offset="1" stopColor="#ffcb80" stopOpacity="0"/></linearGradient></defs>
        <path d="M202 23 844 67 844 124 202 31Z" fill="url(#harbor-lantern)"/>
        <path d="M0 164Q140 108 272 144T570 144Q700 106 858 145T1190 131Q1320 99 1440 107V270H0Z" fill="#364846"/>
        <path d="M0 166Q260 140 508 163T1030 161T1440 153V270H0Z" fill="#486663"/>
        <path d="m1109 163-65 5 109 2-81 6 54 2-40 6 12 2-45 6 80-5-19-3 40-8-30-2 49-8Z" fill="#cbac75"/>
        <g transform="translate(789 193)"><g id="harbor-sailboat">
          <path d="m-36 3 65 1-8 3-53-1Zm9 9 41-1 7 2-33 1Zm17 8 18-2 5 2-19 2Z" fill="#d09c77" opacity=".55"/>
          <path d="M-32-4q15-21 27-68L-7-8Z" fill="#db896b"/>
          <path d="M-3-73Q17-49 26-16L-3-9Z" fill="#efd9b2"/>
          <path d="M-3-73Q4-42 0-10l-3 1Z" fill="#c8b599"/>
          <path d="M-4-78v74" stroke="#3b3933" strokeWidth="2"/>
          <path d="m-5-78-14 3 14 2Z" fill="#f1b761"/>
          <path d="m-40-6 73-3-12 12h-48Z" fill="#293532"/>
          <path d="m-40-6 73-3-3 3-65 3Z" fill="#dbb084"/>
        </g>
        </g>
        <path d="m0 121 111-12 107 17 81 26 92 12 69 23-89 4-72-9-145 12L0 175Z" fill="#87664f"/>
        <path d="m0 139 122-8 93 11 79 25 97 10 69 10-98 11-132-5-86 12L0 196Z" fill="#414442"/>
        <g id="harbor-lighthouse">
          <path d="m184 43-9 106q18 5 37 0l-9-106Z" fill="#efd6ac"/>
          <path d="m181 77 25-8 2 20-29 9Z" fill="#bd6c50"/>
          <path d="m199 44 4-1 9 106-10 2Z" fill="#654934" opacity=".22"/>
          <path d="M192 57q2-4 4 0v7h-4Zm-1 46q2-4 4 0v7h-4Zm-2 47v-12a5 5 0 0 1 10 0v12Z" fill="#564b42"/>
          <path d="M173 149q20 4 41 0v5q-20 4-41 0Z" fill="#c4a484"/>
          <path d="m179 39 29 0-5 6h-19Z" fill="#965d46"/>
          <path d="M184 19h19v18h-19Z" fill="#ffc877"/>
          <path d="m194 21 3 6-3 6-3-6Z" fill="#fff0bd"/>
          <path d="M185 20v16m17-16v16m-14-16v16" stroke="#675044" strokeWidth="1.7"/>
          <path d="m180 19 13-10 14 10v2h-27Z" fill="#b66e53"/>
          <path d="m193 9 14 10h-8Z" fill="#885340"/>
          <path d="M193 9V5m-15 33v-7h31v7m-25-7v7m19-7v7" fill="none" stroke="#987d68" strokeWidth="1.6"/>
          <path d="M176 37h35v3h-35Z" fill="#685448"/>
        </g>
        <path d="m174 124-38-4v-20h38z" fill="#d5b590"/><path d="m130 101 16-16 34 4-5 14Z" fill="#a5654c"/>
        <path d="m0 216 91-10 79 8 89 23 117 11 58 22H0Zm1440-39-97 12-76 33-97 10-106 38h376Z" fill="#283634"/>
        <g fill="none" stroke="#85a49a" strokeWidth="2" strokeLinecap="round"><path d="M468 194h53m12 0h13m162-15h38m-156 46h75m264-25h47m-151 44h92m302-55h32"/></g>
      </svg>
      <svg className="harbor-mobile-panorama" viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
        <circle cx="284" cy="94" r="32" fill="#ffd598"/>
        <path d="M236 112c-8-1-14-5-13-11 1-5 6-8 14-8 3-7 11-11 21-9 7-7 19-9 28-4 5 2 8 6 10 10 8-2 16 1 19 6 6 0 11 4 10 8-1 5-9 8-17 7-7 3-17 4-26 2-8 2-18 2-26-1-7 2-14 1-20 0Z" fill="#384c49"/>
        <path d="M18 124c-7-1-12-4-11-9 1-4 5-7 11-6 3-6 10-9 18-8 6-6 16-7 24-3 4 2 7 5 8 8 7-1 13 1 16 5 5 0 9 3 8 7-1 4-7 6-14 6-6 3-14 3-22 1-7 2-15 2-21-1-6 1-12 1-17 0Z" fill="#314341"/>
        <g fill="#edd3a4"><circle cx="64" cy="64" r="1.8"/><circle cx="123" cy="89" r="2"/><circle cx="225" cy="56" r="1.6"/><path d="m168 59 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/></g>
        <use href="#harbor-gull" x="152" y="114" width="26" height="12" opacity=".78"/>
        <path d="m78 115 322-22v65L78 121Z" fill="url(#harbor-lantern)"/>
        <path d="M0 212q66-35 132-17t135-3q74-28 133-7v115H0Z" fill="#354744"/>
        <path d="M0 208q90-11 189-2t211-7v101H0Z" fill="#486663"/>
        <path d="m278 210-29 4 51 2-36 5 19 2-24 4 47-5-12-3 16-5Z" fill="#c1a276"/>
        <path d="M0 197q72-19 119 6l54 29-74 7L0 226Z" fill="#896b55"/>
        <path d="m0 211 76-5 97 26-66 12L0 232Z" fill="#414846"/>
        <use href="#harbor-lighthouse" transform="translate(-65 98) scale(.72)"/>
        <use href="#harbor-sailboat" transform="translate(290 240) scale(.9)"/>
        <path d="M0 246q51-7 103 16l60 38H0Zm400 5q-60 8-124 49h124Z" fill="#283634"/>
        <path d="M0 266q48-5 96 12t99 10q59-9 98-5t107-18v35H0Z" fill="var(--harbor-shore)" />
        <path d="M118 249h29m23 18h42m17-43h20" stroke="#8ba79b" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    </div>;
  }

  const inSettings = page === "settings" || page === "admin";

  return (
    <div className={`app-shell page-${page} theme-${theme} ${theme === "classic" ? "dark" : ""}`}>
      {theme === "glass" && <Wallpaper variant={wallpaper} staticOnly={page === "player"} />}
      <aside className={`sidebar ${inSettings ? "sidebar-in-settings" : ""}`}>
        <div className="sidebar-brand-row">
          <div
            className="brand"
            role={inSettings ? "button" : undefined}
            tabIndex={inSettings ? 0 : undefined}
            onClick={inSettings ? () => openPage(settingsReturnPageRef.current) : undefined}
            onKeyDown={inSettings ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPage(settingsReturnPageRef.current); } } : undefined}
            style={inSettings ? { cursor: "pointer" } : undefined}
          >
            <span className="brand-mark">
              <MonitorPlay size={23} aria-hidden="true" />
            </span>
            <div>
              <strong>Video Vault</strong>
              <span>Личная медиатека</span>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="icon-text mobile-brand-account-button"
            aria-label={session ? `Настройки аккаунта ${session.login}` : "Войти"}
            onClick={() => (session ? openSettings("account") : openPage("login"))}
          >
            {session ? <UserRound aria-hidden="true" /> : <LogIn aria-hidden="true" />}
            <span>{session ? session.login : "Войти"}</span>
          </Button>
        </div>

        {inSettings ? (
          <nav className="sidebar-settings-nav" aria-label="Категории настроек">
            <button
              type="button"
              className="sidebar-settings-back"
              onClick={() => openPage(settingsReturnPageRef.current)}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              <span className="sidebar-settings-back-full">Назад в медиатеку</span>
              <span className="sidebar-settings-back-short">Назад</span>
            </button>

            <div className="sidebar-settings-groups">
              <div className="sidebar-settings-group">
                <span className="sidebar-settings-group-label">Личные</span>
                <button
                  type="button"
                  className={`sidebar-settings-item ${activeSettingsSection === "appearance" ? "active" : ""}`}
                  aria-current={activeSettingsSection === "appearance" ? "page" : undefined}
                  onClick={() => setSettingsSection("appearance")}
                >
                  <Palette size={17} aria-hidden="true" />
                  <span>Оформление</span>
                </button>
                <button
                  type="button"
                  className={`sidebar-settings-item ${activeSettingsSection === "account" ? "active" : ""}`}
                  aria-current={activeSettingsSection === "account" ? "page" : undefined}
                  onClick={() => setSettingsSection("account")}
                >
                  <UserRound size={17} aria-hidden="true" />
                  <span>Аккаунт</span>
                </button>
              </div>

              {isAdminSession && (
                <div className="sidebar-settings-group">
                  <span className="sidebar-settings-group-label">Администрирование</span>
                  <button
                    type="button"
                    className={`sidebar-settings-item ${activeSettingsSection === "folders" ? "active" : ""}`}
                    aria-current={activeSettingsSection === "folders" ? "page" : undefined}
                    onClick={() => setSettingsSection("folders")}
                  >
                    <FolderOpen size={17} aria-hidden="true" />
                    <span>Папки</span>
                  </button>
                  <button
                    type="button"
                    className={`sidebar-settings-item ${activeSettingsSection === "media" ? "active" : ""}`}
                    aria-current={activeSettingsSection === "media" ? "page" : undefined}
                    onClick={() => setSettingsSection("media")}
                  >
                    <ImageIcon size={17} aria-hidden="true" />
                    <span>Медиа и постеры</span>
                  </button>
                  <button
                    type="button"
                    className={`sidebar-settings-item ${activeSettingsSection === "users" ? "active" : ""}`}
                    aria-current={activeSettingsSection === "users" ? "page" : undefined}
                    onClick={() => setSettingsSection("users")}
                  >
                    <Users size={17} aria-hidden="true" />
                    <span>Пользователи</span>
                    {pendingAccountCount > 0 && <span className="settings-hub-nav-badge">{pendingAccountCount}</span>}
                  </button>
                </div>
              )}
            </div>
          </nav>
        ) : (
          <>
            <nav className="main-nav" aria-label="Основные разделы">
              <Button variant="ghost" aria-current={page === "videos" ? "page" : undefined} className={page === "videos" ? "active" : ""} onClick={() => openPage("videos")}>
                <Grid2X2 size={18} />
                <span>Видео</span>
              </Button>
              <Button variant="ghost" aria-current={page === "files" ? "page" : undefined} className={page === "files" ? "active" : ""} onClick={() => openPage("files")}>
                <FolderOpen size={18} />
                <span>Все файлы</span>
              </Button>
              <Button
                variant="ghost"
                aria-current={inSettings ? "page" : undefined}
                className={inSettings ? "settings-entry active" : "settings-entry"}
                onClick={() => openSettings()}
              >
                <Settings size={18} />
                <span>Настройки</span>
                {isAdminSession && pendingAccountCount > 0 && (
                  <span className="settings-hub-nav-badge">{pendingAccountCount}</span>
                )}
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
                  title={folder.name}
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
          </>
        )}
        <Button variant="ghost" className="sidebar-account" onClick={() => (session ? openSettings("account") : openPage("login"))}>
          <UserRound size={19} />
          <span><strong>{session?.login || "Гостевой просмотр"}</strong><small>{session ? "Настройки аккаунта" : "Войти в аккаунт"}</small></span>
          <ChevronRight size={16} />
        </Button>
      </aside>

      <main ref={contentRef} className={page === "player" ? "content player-page" : "content"}>
        {page === "player" && selectedVideo ? (
          <PlayerPage key={selectedVideo.id} video={selectedVideo} playlist={playerPlaylist} onSelectVideo={openPlayer} onBack={closePlayer}
            playlistCollapsed={playlistCollapsed} onPlaylistCollapsedChange={setPlaylistCollapsed}
            connectedTv={connectedTv} tvCount={tvDevices.length} queueCount={tvQueue.length}
            onCastToTV={(video) => setTvCastModal({ open: true, focusItem: videoToTVQueueItem(video), fromPlayer: true })} />
        ) : page === "player" ? (
          <section className="empty-folder">
            <MonitorPlay size={34} />
            <h2>Загрузка видео</h2>
            <p>Восстанавливаем открытый плеер после обновления страницы.</p>
          </section>
        ) : null}
        {inSettings ? (
          <SettingsPanel
            section={activeSettingsSection}
            theme={theme}
            wallpaper={wallpaper}
            session={session}
            folders={rootFolders}
            allFolders={folders}
            videos={videos}
            scrollContainerRef={contentRef}
            onPendingCountChange={setPendingAccountCount}
            onThemeChange={setTheme}
            onWallpaperChange={setWallpaper}
            onOpenLogin={() => openPage("login")}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onFolderCreated={handleFolderCreated}
            onFolderUpdated={handleFolderUpdated}
            onFolderDeleted={handleFolderDeleted}
            onVideoUpdated={handleVideoUpdated}
            onVideoDeleted={handleVideoDeleted}
            onFileDeleted={handleFileDeleted}
          />
        ) : (
          <div className="browse-page" hidden={page === "player"}>
            <header className="topbar">
              <div>
                <p className="eyebrow">{theme === "classic" ? "Медиатека / " + (browsePage === "files" ? "Файлы" : "Видео") : pageEyebrow}</p>
                <h1>{pageTitle}</h1>
              </div>
              <div className="topbar-actions">
                <TVStatusPill
                  tvDevices={tvDevices}
                  connectedTv={connectedTv}
                  queueCount={tvQueue.length}
                  tvNowPlaying={tvNowPlaying}
                  wsConnected={wsConnected}
                  onClick={() => setTvCastModal({ open: true, focusItem: null })}
                />
                <Button type="button" variant="outline" className="icon-text browse-account-button"
                  aria-label={session ? `Настройки аккаунта ${session.login}` : undefined}
                  onClick={() => openPage(session ? "settings" : "login")}>
                  {session ? <UserRound aria-hidden="true" /> : <LogIn aria-hidden="true" />}
                  <span>{session ? session.login : "Войти"}</span>
                </Button>
              </div>
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
                onOpenFolder={(folder) => setCurrentFolderId(folder.id)}
                onOpenRoot={() => setCurrentFolderId(null)}
                onOpenVideo={openPlayer}
                getVideoHref={getVideoHref}
                tvCount={tvDevices.length}
                tvQueueIds={tvQueueIdSet}
                playingOnTvId={tvNowPlaying?.entryId ?? null}
                playingOnTvDeviceName={activeTargetTv?.name}
                onCastItemToTV={(item) => setTvCastModal({ open: true, focusItem: item })}
                onToggleItemInTVQueue={toggleItemInQueue}
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
                    <VideoItem
                      key={video.id}
                      video={video}
                      mode={viewMode}
                      href={getVideoHref(video.id)}
                      onPlay={() => openPlayer(video)}
                      tvCount={tvDevices.length}
                      inTVQueue={tvQueueIdSet.has(video.id)}
                      playingOnTv={tvNowPlaying?.entryId === video.id}
                      playingOnTvDeviceName={activeTargetTv?.name}
                      onCastToTV={(item) => setTvCastModal({ open: true, focusItem: videoToTVQueueItem(item) })}
                      onToggleTVQueue={(item) => toggleItemInQueue(videoToTVQueueItem(item))}
                    />
                  ))}
                </section>
              </>
            )}
          </div>
        )}
      </main>
      <TVCastModal
        open={tvCastModal.open}
        focusItem={tvCastModal.focusItem}
        playerPlaylistItems={tvCastModal.fromPlayer ? playerPlaylist.map(videoToTVQueueItem) : undefined}
        tvDevices={tvDevices}
        connectedTv={connectedTv}
        tvQueue={tvQueue}
        activeQueueItemId={activeQueueItemId}
        tvNowPlaying={tvNowPlaying}
        tvNowPlayingByDevice={tvNowPlayingByDevice}
        isSyncedWithTv={isSyncedWithTv}
        wsConnected={wsConnected}
        theme={theme}
        onClose={() => setTvCastModal({ open: false, focusItem: null })}
        onSelectTv={selectTvDevice}
        onPlayItems={playItemsOnTV}
        onPlayFromQueue={playFromQueueIndex}
        onSyncQueue={syncQueueToTV}
        onStopOnTv={stopOnTV}
        onDisconnect={disconnectFromTV}
        onAddItem={addItemToQueue}
        onRemoveItem={removeItemFromQueue}
        onMoveItem={moveQueueItem}
        onClearQueue={clearQueue}
      />
      {page !== "player" && (
        <TVFloatingDock
          connectedTv={connectedTv}
          tvDevices={tvDevices}
          queue={tvQueue}
          activeItemId={activeQueueItemId}
          tvNowPlaying={tvNowPlaying}
          hasBackToTop={showBackToTop}
          collapsed={tvDockCollapsed}
          onCollapsedChange={setTvDockCollapsed}
          onOpenModal={() => setTvCastModal({ open: true, focusItem: null })}
          onPlayQueue={() => {
            const target = connectedTv ?? activeTargetTv ?? (tvDevices.length === 1 ? tvDevices[0] : null);
            if (target && tvQueue.length > 0) {
              void playItemsOnTV(target, tvQueue, "replace");
            }
          }}
          onStopOnTv={(device) => void stopOnTV(device)}
          onDisconnect={() => void disconnectFromTV({ stopPlayback: false })}
        />
      )}
      <VaultLiveToast toast={toast} />
      {showBackToTop && page !== "player" && <button className={`back-to-top ${(connectedTv || tvQueue.length > 0 || tvNowPlaying) && !tvDockCollapsed ? "above-tv-dock" : ""}`} aria-label="Вернуться в начало" title="Наверх" onClick={() => {
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

type SettingsSectionId = "appearance" | "account" | "folders" | "media" | "users";

const settingsSectionStorageKey = "local-video-vault-settings-section";

function SettingsPanel({
  section,
  theme,
  wallpaper,
  session,
  folders,
  allFolders,
  videos,
  scrollContainerRef,
  onPendingCountChange,
  onThemeChange,
  onWallpaperChange,
  onOpenLogin,
  onLogin,
  onLogout,
  onFolderCreated,
  onFolderUpdated,
  onFolderDeleted,
  onVideoUpdated,
  onVideoDeleted,
  onFileDeleted
}: {
  section: SettingsSectionId;
  theme: "classic" | "glass";
  wallpaper: WallpaperVariant;
  session: AdminSession | null;
  folders: VaultFolder[];
  allFolders: VaultFolder[];
  videos: VideoFile[];
  scrollContainerRef: RefObject<HTMLElement | null>;
  onPendingCountChange?: (count: number) => void;
  onThemeChange: (theme: "classic" | "glass") => void;
  onWallpaperChange: (wallpaper: WallpaperVariant) => void;
  onOpenLogin: () => void;
  onLogin: (session: AdminSession) => void;
  onLogout: () => void;
  onFolderCreated: (payload: { folder: VaultFolder }) => void;
  onFolderUpdated: (folder: VaultFolder) => void;
  onFolderDeleted: (folderId: string) => Promise<void>;
  onVideoUpdated: (video: VideoFile) => void;
  onVideoDeleted: (videoId: string) => void;
  onFileDeleted: (fileId: string) => void;
}) {
  const admin = isAdministrator(session);
  const activeSection: SettingsSectionId =
    !admin && (section === "folders" || section === "media" || section === "users") ? "account" : section;

  const sectionMeta: Record<SettingsSectionId, { eyebrow: string; title: string; description: string }> = {
    appearance: {
      eyebrow: "Настройки / Личные",
      title: "Оформление",
      description: "Тема интерфейса и фоновые сцены для режима «Стекло»"
    },
    account: {
      eyebrow: "Настройки / Личные",
      title: "Аккаунт и безопасность",
      description: session ? `Вы вошли как ${session.login}` : "Авторизация и параметры вашего профиля"
    },
    folders: {
      eyebrow: "Настройки / Администрирование",
      title: "Папки и сканирование",
      description: "Подключённые директории сервера, видимость разделов и переиндексация"
    },
    media: {
      eyebrow: "Настройки / Администрирование",
      title: "Медиа и постеры",
      description: "Замена обложек видео и удаление файлов из медиатеки"
    },
    users: {
      eyebrow: "Настройки / Администрирование",
      title: "Пользователи и заявки",
      description: "Одобрение новых аккаунтов, роли, активные сеансы и доступ"
    }
  };

  const currentMeta = sectionMeta[activeSection];

  return (
    <section className="settings-hub settings-page" aria-labelledby="settings-title">
      <header className="settings-hub-header">
        <div className="settings-hub-header-copy">
          <span className="settings-hub-eyebrow">{currentMeta.eyebrow}</span>
          <h1 id="settings-title">{currentMeta.title}</h1>
          <p className="settings-hub-subtitle">{currentMeta.description}</p>
        </div>
        <div className="settings-hub-header-actions">
          {session ? (
            <Button type="button" variant="outline" className="icon-text settings-logout" onClick={onLogout}>
              <LogOut size={16} aria-hidden="true" />
              <span className="settings-logout-label">Выйти</span>
            </Button>
          ) : (
            <Button type="button" className="primary-button" onClick={onOpenLogin}>
              <LogIn size={16} aria-hidden="true" />
              <span>Войти</span>
            </Button>
          )}
        </div>
      </header>

      <div key={activeSection} className="settings-hub-content">

          {activeSection === "appearance" && (
            <>
              <div className="settings-hub-card">
                <div className="settings-hub-card-head">
                  <div>
                    <h3>Тема интерфейса</h3>
                    <p>Выберите классический графит или полупрозрачное стекло</p>
                  </div>
                </div>
                <div className="theme-choice" role="group" aria-label="Тема оформления">
                  <button type="button" aria-pressed={theme === "classic"} onClick={() => onThemeChange("classic")}>
                    <span className="theme-swatch classic-swatch"><i /><i /><i /></span>
                    <span><strong>Классическая</strong><small>Тёмная рабочая область</small></span>
                    {theme === "classic" && <Check size={18} />}
                  </button>
                  <button type="button" aria-pressed={theme === "glass"} onClick={() => onThemeChange("glass")}>
                    <span className="theme-swatch glass-swatch"><i /><i /><i /></span>
                    <span><strong>Стекло</strong><small>Видео и матовые поверхности</small></span>
                    {theme === "glass" && <Check size={18} />}
                  </button>
                </div>
              </div>

              <div className="settings-hub-card">
                <div className="settings-hub-card-head">
                  <div>
                    <h3>Фоновое оформление</h3>
                    <p>Отображается в теме «Стекло»</p>
                  </div>
                </div>
                <div className="wallpaper-choice" role="radiogroup" aria-label="Фоновое оформление">
                  {wallpaperChoices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
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
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {activeSection === "account" && (
            <>
              <div className="settings-hub-card">
                <div className="settings-profile-banner">
                  <div className="settings-profile-identity">
                    <span className={`settings-profile-avatar ${admin ? "is-admin" : ""}`}>
                      {session ? session.login.slice(0, 2).toUpperCase() : <UserRound size={20} />}
                    </span>
                    <div className="settings-profile-meta">
                      <strong>{session?.login ?? "Гостевой режим"}</strong>
                      <span className="settings-profile-role">
                        {admin && <Shield size={13} aria-hidden="true" />}
                        {session ? (admin ? "Администратор" : "Пользователь") : "Аккаунт не подключён"}
                      </span>
                    </div>
                  </div>
                  {session ? (
                    <Button type="button" variant="outline" className="ghost-button" onClick={onLogout}>
                      <LogOut size={16} aria-hidden="true" />
                      <span>Выйти из аккаунта</span>
                    </Button>
                  ) : (
                    <Button type="button" className="primary-button" onClick={onOpenLogin}>
                      <LogIn size={16} aria-hidden="true" />
                      <span>Войти в аккаунт</span>
                    </Button>
                  )}
                </div>
              </div>

              {session && (
                <div className="settings-hub-card">
                  <div className="settings-hub-card-head">
                    <div>
                      <h3>Смена пароля</h3>
                      <p>Обновите пароль для входа в ваш аккаунт</p>
                    </div>
                  </div>
                  <div className="account-center settings-password-wrap">
                    <PasswordForm />
                  </div>
                </div>
              )}
            </>
          )}

          {admin && activeSection === "folders" && (
            <div className="account-center management-page">
              <div className="library-admin">
                <AdminPage
                  section="folders"
                  folders={folders}
                  allFolders={allFolders}
                  videos={videos}
                  scrollContainerRef={scrollContainerRef}
                  session={session}
                  onLogin={onLogin}
                  onLogout={onLogout}
                  onFolderCreated={onFolderCreated}
                  onFolderUpdated={onFolderUpdated}
                  onFolderDeleted={onFolderDeleted}
                  onVideoUpdated={onVideoUpdated}
                  onVideoDeleted={onVideoDeleted}
                  onFileDeleted={onFileDeleted}
                />
              </div>
            </div>
          )}

          {admin && activeSection === "media" && (
            <div className="account-center management-page">
              <div className="library-admin">
                <AdminPage
                  section="media"
                  folders={folders}
                  allFolders={allFolders}
                  videos={videos}
                  scrollContainerRef={scrollContainerRef}
                  session={session}
                  onLogin={onLogin}
                  onLogout={onLogout}
                  onFolderCreated={onFolderCreated}
                  onFolderUpdated={onFolderUpdated}
                  onFolderDeleted={onFolderDeleted}
                  onVideoUpdated={onVideoUpdated}
                  onVideoDeleted={onVideoDeleted}
                  onFileDeleted={onFileDeleted}
                />
              </div>
            </div>
          )}

          {admin && session && activeSection === "users" && (
            <AdminUsersPanel session={session} onPendingCountChange={onPendingCountChange} />
          )}
      </div>
    </section>
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

function FileBrowser({
  entries,
  breadcrumbs,
  currentFolder,
  viewMode,
  fileTypeFilter,
  onOpenFolder,
  onOpenRoot,
  onOpenVideo,
  getVideoHref,
  tvCount,
  tvQueueIds,
  playingOnTvId,
  playingOnTvDeviceName,
  onCastItemToTV,
  onToggleItemInTVQueue
}: {
  entries: FileBrowserEntry[];
  breadcrumbs: VaultFolder[];
  currentFolder: VaultFolder | null;
  viewMode: ViewMode;
  fileTypeFilter: FileTypeFilter;
  onOpenFolder: (folder: VaultFolder) => void;
  onOpenRoot: () => void;
  onOpenVideo: (video: VideoFile) => void;
  getVideoHref: (videoId: string) => string;
  tvCount: number;
  tvQueueIds: Set<string>;
  playingOnTvId?: string | null;
  playingOnTvDeviceName?: string;
  onCastItemToTV: (item: TVQueueItem) => void;
  onToggleItemInTVQueue: (item: TVQueueItem) => void;
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
          <h2>Нет содержимого типа «{fileTypeLabels[fileTypeFilter]}»</h2>
          <p>Выберите другой тип в фильтре или откройте другую папку.</p>
        </section>
      ) : (
        <section className={viewMode === "tiles" ? "file-grid" : "file-list"} aria-label="Все файлы">
          {entries.map((entry) =>
            entry.type === "folder" ? (
              <FolderItem key={entry.folder.id} folder={entry.folder} onOpen={() => onOpenFolder(entry.folder)} />
            ) : entry.type === "video" ? (
              <VideoItem
                key={entry.video.id}
                video={entry.video}
                mode={viewMode}
                href={getVideoHref(entry.video.id)}
                onPlay={() => onOpenVideo(entry.video)}
                tvCount={tvCount}
                inTVQueue={tvQueueIds.has(entry.video.id)}
                playingOnTv={playingOnTvId === entry.video.id}
                playingOnTvDeviceName={playingOnTvDeviceName}
                onCastToTV={(video) => onCastItemToTV(videoToTVQueueItem(video))}
                onToggleTVQueue={(video) => onToggleItemInTVQueue(videoToTVQueueItem(video))}
              />
            ) : (
              <FileItem
                key={entry.file.id}
                file={entry.file}
                onPreview={() => setPreviewFile(entry.file)}
                tvCount={tvCount}
                inTVQueue={tvQueueIds.has(entry.file.id)}
                onCastAudioToTV={(file) => onCastItemToTV(audioFileToTVQueueItem(file))}
                onToggleAudioInTVQueue={(file) => onToggleItemInTVQueue(audioFileToTVQueueItem(file))}
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

const filePreviewIcons = [
  { icon: FileText, extensions: /^(PDF|DOCX?|ODT|RTF|TXT|MD)$/ },
  { icon: FileSpreadsheet, extensions: /^(XLSX?|XLSM|ODS|CSV|TSV)$/ },
  { icon: Presentation, extensions: /^(PPTX?|ODP|KEY)$/ },
  { icon: FileArchive, extensions: /^(ZIP|7Z|RAR|TAR|GZ|TGZ|BZ2|XZ)$/ },
  { icon: FileAudio, extensions: /^(MP3|AAC|FLAC|WAV|OGG|OPUS|M4A)$/ },
  { icon: FileCode2, extensions: /^(HTML?|CSS|JS|TS|JSX|TSX|JSON|XML|YAML|YML|SQL|PY|SH|PS1)$/ }
];

function FileTypePreview({ extension, mimeType }: { extension: string; mimeType?: string }) {
  const Icon = filePreviewIcons.find(({ extensions }) => extensions.test(extension))?.icon
    ?? (mimeType?.toLowerCase().startsWith("audio/") ? FileAudio : FileIcon);

  return <span className="file-type-preview" aria-hidden="true">
    <span className="file-type-preview-icon"><Icon size={27} strokeWidth={1.7} /></span>
    <span className="file-type-extension">{extension}</span>
  </span>;
}

function FileItem({ file, onPreview, tvCount = 0, inTVQueue = false, onCastAudioToTV, onToggleAudioInTVQueue }: {
  file: SharedFile;
  onPreview: () => void;
  tvCount?: number;
  inTVQueue?: boolean;
  onCastAudioToTV?: (file: SharedFile) => void;
  onToggleAudioInTVQueue?: (file: SharedFile) => void;
}) {
  const image = isImageFile(file);
  const audio = isAudioSharedFile(file);
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
          <FileTypePreview extension={extension} mimeType={file.mimeType} />
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
    <article className={image ? "shared-file-card" : "shared-file-card document-file-card"}>
      {audio && onCastAudioToTV && onToggleAudioInTVQueue && (
        <TVCastCardControls
          tvCount={tvCount}
          inQueue={inTVQueue}
          itemTitle={displayName}
          onOpenCast={() => onCastAudioToTV(file)}
          onToggleQueue={() => onToggleAudioInTVQueue(file)}
        />
      )}
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

function VideoItem({ video, mode, href, onPlay, tvCount = 0, inTVQueue = false, playingOnTv = false, playingOnTvDeviceName, onCastToTV, onToggleTVQueue }: {
  video: VideoFile;
  mode: ViewMode;
  href: string;
  onPlay: () => void;
  tvCount?: number;
  inTVQueue?: boolean;
  playingOnTv?: boolean;
  playingOnTvDeviceName?: string;
  onCastToTV?: (video: VideoFile) => void;
  onToggleTVQueue?: (video: VideoFile) => void;
}) {
  const duration = formatDuration(video.duration);

  return (
    <article className={`video-item ${playingOnTv ? "playing-on-tv" : ""}`}>
      <VideoProblemBadge id={video.id} />
      <a className="poster-button" href={href} rel="noopener" aria-label={`Открыть ${video.title}`} onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onPlay();
      }}>
        <PosterImage video={video} />
        {playingOnTv && <TVCardNowPlayingBadge deviceName={playingOnTvDeviceName} />}
        <span className="play-badge">
          <Play size={18} fill="currentColor" />
        </span>
        <span className="duration">{duration}</span>
      </a>

      <div className="video-info">
        <div>
          <h2>{video.title}</h2>
          <p>{video.folderName}</p>
        </div>
        <footer className="video-info-footer">
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
          {onCastToTV && onToggleTVQueue && (
            <TVCastCardControls
              tvCount={tvCount}
              inQueue={inTVQueue}
              itemTitle={video.title}
              inline
              onOpenCast={() => onCastToTV(video)}
              onToggleQueue={() => onToggleTVQueue(video)}
            />
          )}
        </footer>
      </div>
    </article>
  );
}

const defaultSeekSeconds = 5;

function PlayerPage({ video, playlist, onSelectVideo, onBack, playlistCollapsed, onPlaylistCollapsedChange, connectedTv, tvCount, queueCount, onCastToTV }: {
  video: VideoFile;
  playlist: VideoFile[];
  onSelectVideo: (video: VideoFile) => void;
  onBack: () => void;
  playlistCollapsed: boolean;
  onPlaylistCollapsedChange: (collapsed: boolean) => void;
  connectedTv: TVDevice | null;
  tvCount: number;
  queueCount: number;
  onCastToTV: (video: VideoFile) => void;
}) {
  const duration = formatDuration(video.duration);
  const mediaRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const [videoAspect, setVideoAspect] = useState(() => {
    const dimensions = video.resolution?.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    const aspect = Number(dimensions?.[1]) / Number(dimensions?.[2]);
    return Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  });
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
    const content = layout?.parentElement;
    const topbar = topbarRef.current;
    if (!media || !stage || !layout || !content || !topbar) return;
    const updateAspect = () => {
      if (media.videoWidth && media.videoHeight) setVideoAspect(media.videoWidth / media.videoHeight);
    };
    const measure = () => {
      const layoutTop = layout.getBoundingClientRect().top + content.scrollTop + window.scrollY;
      const bottomPadding = parseFloat(getComputedStyle(content).paddingBottom);
      const availableHeight = Math.max(120, window.innerHeight - layoutTop - bottomPadding);
      layout.style.setProperty("--watch-available-height", `${availableHeight}px`);
    };
    updateAspect();
    measure();
    media.addEventListener("loadedmetadata", updateAspect);
    media.addEventListener("resize", updateAspect);
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(topbar);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
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
      seekbackward: (details) => seek(-(details.seekOffset ?? defaultSeekSeconds)),
      seekforward: (details) => seek(details.seekOffset ?? defaultSeekSeconds),
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
      seek(side === "left" ? -defaultSeekSeconds : defaultSeekSeconds);
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

  const videoDetails = [
    { label: "Длительность", value: duration, icon: Clock3 },
    { label: "Разрешение", value: video.resolution, icon: Monitor },
    { label: "Кодек", value: video.codec, icon: FileVideo },
    { label: "Папка", value: video.folderName || video.path, icon: Folder, hint: video.path }
  ].filter(({ value }) => value);

  return (
    <>
      <header className="player-topbar" ref={topbarRef}>
        <Button variant="outline" className="player-back-button" onClick={onBack} type="button" aria-label="Вернуться назад">
          <ArrowLeft size={18} />
          <span>Назад</span>
        </Button>
        <div>
          <p className="eyebrow">Медиатека / Плеер</p>
          <h1>{video.title}</h1>
          {videoDetails.length > 0 && <dl className="watch-video-details">
            {videoDetails.map(({ label, value, icon: Icon, hint }) => (
              <div key={label}>
                <dt className="visually-hidden">{label}</dt>
                <dd title={hint || `${label} · ${value}`}>
                  <Icon size={14} aria-hidden="true" />
                  <span>{value}</span>
                </dd>
              </div>
            ))}
          </dl>}
        </div>
        <div className="player-topbar-actions">
          <TVPlayerButton connectedTv={connectedTv} tvCount={tvCount} queueCount={queueCount} onClick={() => onCastToTV(video)} />
          <VideoProblemControl key={video.id} id={video.id} title={video.title} getTime={() => mediaRef.current?.currentTime ?? 0} />
        </div>
      </header>

      <div className="watch-layout" style={{ "--video-aspect": videoAspect } as CSSProperties}><div className="watch-main">
      <section className={`player-surface custom-player ${controlsVisible || playerSettings || !playing || isBuffering || error ? "controls-visible" : ""} ${forcedLandscape ? "forced-landscape" : ""} ${isAppFullscreen ? "app-fullscreen" : ""}`} ref={stageRef}
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
          if (event.key === "ArrowLeft") seek(-defaultSeekSeconds);
          if (event.key === "ArrowRight") seek(defaultSeekSeconds);
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
              <span>{tapFeedback === "left" ? "−" : "+"}{defaultSeekSeconds}</span>
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

      </div>
      <PlayerPlaylist playlist={playlist} currentIndex={currentIndex} autoplay={autoplayNext} onAutoplayChange={setAutoplayNext}
        collapsed={playlistCollapsed} onCollapsedChange={onPlaylistCollapsedChange}
        onSelect={onSelectVideo} renderPoster={item => <><PosterImage video={item} /><span>{formatDuration(item.duration)}</span></>} />
      </div>
    </>
  );
}

function AdminPage({
  section = "all",
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
  section?: "folders" | "media" | "all";
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
          {(section === "all" || section === "folders") && (
            <>
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
            </>
          )}

          {(section === "all" || section === "media") && (
            <>
              {section === "media" && error && <p className="error">{error}</p>}
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
            </>
          )}
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
  const imageFile = isImageFile(file);
  const image = imageFile && !previewFailed;
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
        ) : imageFile ? (
          <span className="admin-media-file-type" aria-hidden="true">
            <ImageIcon size={42} />
            <b>{extensionLabel}</b>
          </span>
        ) : <FileTypePreview extension={extension} mimeType={file.mimeType} />}
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

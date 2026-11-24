export type ViewMode = "tiles" | "list";
export type Page = "videos" | "files" | "player" | "admin" | "settings" | "login";

export type VideoFile = {
  id: string;
  title: string;
  folderId: string;
  folderName: string;
  parentFolderId: string;
  size: string;
  sizeBytes: number;
  duration: string | number;
  modifiedAt: string;
  codec: string;
  resolution: string;
  posterUrl: string;
  posterRevision?: number;
  streamUrl: string;
  extension?: string;
  path: string;
};

export type VideoAudioTrack = {
  id: string;
  title: string;
  language: string;
};

export type Folder = {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  rootFolderId: string;
  isRoot: boolean;
  enabled: boolean;
  filesCount: number;
  videoCount: number;
  childFolderCount: number;
  lastScanAt: string;
};

export type SharedFile = {
  id: string;
  name: string;
  path: string;
  folderId: string;
  folderName: string;
  parentFolderId: string;
  extension: string;
  size: string;
  sizeBytes: number;
  modifiedAt: string;
  mimeType?: string;
};

export type FileBrowserEntry =
  | {
      type: "folder";
      folder: Folder;
    }
  | {
      type: "video";
      video: VideoFile;
    }
  | {
      type: "file";
      file: SharedFile;
    };

export type AdminSession = {
  token?: string;
  login: string;
  role?: "admin" | "user";
  userId?: string;
};

export type AccountStatus = "pending" | "active" | "blocked" | "rejected";

export type Account = {
  id: string;
  login: string;
  role: "admin" | "user";
  status: AccountStatus;
  createdAt: string;
};

export type ServerFolderEntry = {
  name: string;
  path: string;
  isRoot?: boolean;
};

export type ServerFolderBrowseResponse = {
  path: string;
  parent: string;
  entries: ServerFolderEntry[];
};

export type TVDevice = {
  id: string;
  name: string;
  type: string;
};

export type TVEntryType = "video" | "file" | "audio";

export type TVEntry = {
  id: string;
  type: TVEntryType;
};

export type TVOpenMode = "replace" | "append" | "sync" | "stop";

export type CmdOpenOnTV = {
  deviceId: string;
  mode: TVOpenMode;
  entries: TVEntry[];
  fromDeviceId?: string;
  fromDeviceName?: string;
  senderName?: string;
};

export type TVQueueItem = {
  id: string;
  type: TVEntryType;
  title: string;
  subtitle?: string;
  posterUrl?: string;
  duration?: string;
};

export type TVPlayNowStatus = "playing" | "paused" | "stopped";

export type TVNowPlaying = {
  deviceId: string;
  entryId: string;
  type: TVEntryType;
  title?: string;
  subtitle?: string;
  posterUrl?: string;
  isPlaying: boolean;
  status: TVPlayNowStatus;
  source?: "local" | "remote";
  updatedAt: number;
};

export type CmdPlayNowOnTV = {
  deviceId: string;
  entry: TVEntry;
};

export type TVPlayNowPayload = {
  deviceId: string;
  deviceName?: string;
  entry?: TVEntry | null;
  entries?: TVEntry[];
  id?: string;
  videoId?: string;
  entryId?: string;
  type?: TVEntryType | "";
  title?: string;
  playing?: boolean;
  isPlaying?: boolean;
  status?: TVPlayNowStatus;
  source?: "local" | "remote" | "";
};

export type LibraryUpdateCommandType = "add" | "delete";

export type CmdUpdateLibrary = {
  file: FileBrowserEntry;
  type: LibraryUpdateCommandType;
};

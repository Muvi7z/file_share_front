export type ViewMode = "tiles" | "list";
export type Page = "videos" | "files" | "player" | "admin";

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
  streamUrl: string;
  path: string;
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

export type FileBrowserEntry =
  | {
      type: "folder";
      folder: Folder;
    }
  | {
      type: "video";
      video: VideoFile;
    };

export type AdminSession = {
  token: string;
  login: string;
  role?: "admin" | "user";
  userId?: string;
};

export type Account = {
  id: string;
  login: string;
  role: "admin" | "user";
  status: "pending" | "active" | "blocked" | "rejected";
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

package com.localvideovault.mobile.data;

import com.localvideovault.mobile.model.FileEntry;
import com.localvideovault.mobile.model.SharedFolder;
import com.localvideovault.mobile.model.VideoFile;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class VaultRepository {
    private final List<SharedFolder> folders = new ArrayList<>();
    private final List<VideoFile> videos = new ArrayList<>();

    public VaultRepository() {
    }

    public List<SharedFolder> getFolders() {
        return new ArrayList<>(folders);
    }

    public void replaceData(List<SharedFolder> nextFolders, List<VideoFile> nextVideos) {
        folders.clear();
        folders.addAll(nextFolders);
        videos.clear();
        videos.addAll(nextVideos);
    }

    public void mergeFileEntries(List<FileEntry> entries) {
        for (FileEntry entry : entries) {
            if (entry.type == FileEntry.Type.FOLDER && entry.folder != null) {
                upsertFolder(entry.folder);
            } else if (entry.type == FileEntry.Type.VIDEO && entry.video != null) {
                upsertVideo(entry.video);
            }
        }
    }

    public List<SharedFolder> getEnabledFolders() {
        List<SharedFolder> result = new ArrayList<>();
        for (SharedFolder folder : folders) {
            if (folder.isRoot && folder.enabled) {
                result.add(folder);
            }
        }
        return result;
    }

    public List<VideoFile> getVideos(String folderId, String query) {
        String normalized = query == null ? "" : query.trim().toLowerCase();
        Set<String> enabledRootIds = enabledRootIds();

        List<VideoFile> result = new ArrayList<>();
        for (VideoFile video : videos) {
            boolean matchesFolder = "all".equals(folderId) || video.folderId.equals(folderId);
            boolean matchesQuery = normalized.isEmpty()
                || (video.title + " " + video.folderName + " " + video.codec + " " + video.resolution).toLowerCase().contains(normalized);
            if (enabledRootIds.contains(video.folderId) && matchesFolder && matchesQuery) {
                result.add(video);
            }
        }
        return result;
    }

    public List<FileEntry> getDirectoryEntries(String folderId, String query) {
        String normalized = query == null ? "" : query.trim().toLowerCase();
        Set<String> enabledRootIds = enabledRootIds();

        List<FileEntry> result = new ArrayList<>();
        for (SharedFolder folder : folders) {
            boolean isRoot = folderId == null && folder.parentId == null;
            boolean isChild = folderId != null && folderId.equals(folder.parentId);
            boolean matchesQuery = normalized.isEmpty() || folder.name.toLowerCase().contains(normalized);
            if (enabledRootIds.contains(folder.rootFolderId) && (isRoot || isChild) && matchesQuery) {
                result.add(FileEntry.folder(folder));
            }
        }

        if (folderId != null) {
            for (VideoFile video : videos) {
                boolean matchesQuery = normalized.isEmpty()
                    || (video.title + " " + video.codec + " " + video.resolution).toLowerCase().contains(normalized);
                if (folderId.equals(video.parentDirectoryId) && matchesQuery) {
                    result.add(FileEntry.video(video));
                }
            }
        }

        return result;
    }

    public SharedFolder getDirectory(String folderId) {
        if (folderId == null) {
            return null;
        }
        for (SharedFolder folder : folders) {
            if (folder.id.equals(folderId)) {
                return folder;
            }
        }
        return null;
    }

    public List<SharedFolder> getBreadcrumbs(String folderId) {
        List<SharedFolder> result = new ArrayList<>();
        SharedFolder cursor = getDirectory(folderId);
        while (cursor != null) {
            result.add(0, cursor);
            cursor = getDirectory(cursor.parentId);
        }
        return result;
    }

    private Set<String> enabledRootIds() {
        Set<String> result = new HashSet<>();
        for (SharedFolder folder : getEnabledFolders()) {
            result.add(folder.id);
        }
        return result;
    }

    private void upsertFolder(SharedFolder folder) {
        for (int index = 0; index < folders.size(); index++) {
            if (folders.get(index).id.equals(folder.id)) {
                folders.set(index, folder);
                return;
            }
        }
        folders.add(folder);
    }

    private void upsertVideo(VideoFile video) {
        for (int index = 0; index < videos.size(); index++) {
            if (videos.get(index).id.equals(video.id)) {
                videos.set(index, video);
                return;
            }
        }
        videos.add(video);
    }

}

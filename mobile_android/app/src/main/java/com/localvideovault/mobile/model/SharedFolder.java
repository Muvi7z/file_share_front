package com.localvideovault.mobile.model;

public class SharedFolder {
    public final String id;
    public final String name;
    public final String path;
    public final String parentId;
    public final String rootFolderId;
    public final boolean isRoot;
    public final int filesCount;
    public final int videoCount;
    public final int childFolderCount;
    public final boolean enabled;
    public final String lastScanAt;

    public SharedFolder(
        String id,
        String name,
        String path,
        String parentId,
        String rootFolderId,
        boolean isRoot,
        int filesCount,
        int videoCount,
        int childFolderCount,
        boolean enabled,
        String lastScanAt
    ) {
        this.id = id;
        this.name = name;
        this.path = path;
        this.parentId = parentId;
        this.rootFolderId = rootFolderId;
        this.isRoot = isRoot;
        this.filesCount = filesCount;
        this.videoCount = videoCount;
        this.childFolderCount = childFolderCount;
        this.enabled = enabled;
        this.lastScanAt = lastScanAt;
    }
}

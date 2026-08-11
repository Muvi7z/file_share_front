package com.localvideovault.mobile.model;

public class VideoFile {
    public final String id;
    public final String title;
    public final String folderId;
    public final String folderName;
    public final String parentDirectoryId;
    public final String size;
    public final long sizeBytes;
    public final String duration;
    public final String modifiedAt;
    public final String codec;
    public final String resolution;
    public final String posterUrl;
    public final String streamUrl;
    public final String path;

    public VideoFile(
        String id,
        String title,
        String folderId,
        String folderName,
        String parentDirectoryId,
        String size,
        long sizeBytes,
        String duration,
        String modifiedAt,
        String codec,
        String resolution,
        String posterUrl,
        String streamUrl,
        String path
    ) {
        this.id = id;
        this.title = title;
        this.folderId = folderId;
        this.folderName = folderName;
        this.parentDirectoryId = parentDirectoryId;
        this.size = size;
        this.sizeBytes = sizeBytes;
        this.duration = duration;
        this.modifiedAt = modifiedAt;
        this.codec = codec;
        this.resolution = resolution;
        this.posterUrl = posterUrl;
        this.streamUrl = streamUrl;
        this.path = path;
    }
}

package com.localvideovault.mobile.model;

public class FileEntry {
    public enum Type {
        FOLDER,
        VIDEO
    }

    public final Type type;
    public final SharedFolder folder;
    public final VideoFile video;

    private FileEntry(Type type, SharedFolder folder, VideoFile video) {
        this.type = type;
        this.folder = folder;
        this.video = video;
    }

    public static FileEntry folder(SharedFolder folder) {
        return new FileEntry(Type.FOLDER, folder, null);
    }

    public static FileEntry video(VideoFile video) {
        return new FileEntry(Type.VIDEO, null, video);
    }
}

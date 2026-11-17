package com.localvideovault.mobile.model;

import org.json.JSONObject;

import java.util.Locale;

public class FileEntry {
    public enum Type {
        FOLDER,
        VIDEO,
        FILE
    }

    public final Type type;
    public final SharedFolder folder;
    public final VideoFile video;
    public final String fileId;
    public final String fileName;
    public final String extension;
    public final long sizeBytes;
    public final String modifiedAt;
    public final boolean image;

    private FileEntry(Type type, SharedFolder folder, VideoFile video, JSONObject file) {
        this.type = type;
        this.folder = folder;
        this.video = video;
        fileId = file == null ? "" : file.optString("id");
        String name = file == null ? "" : file.optString("name");
        String ext = file == null ? "" : file.optString("extension").trim().replaceFirst("^\\.+", "");
        int dot = name.lastIndexOf('.');
        extension = (ext.isEmpty() && dot > 0 ? name.substring(dot + 1) : ext).toLowerCase(Locale.ROOT);
        fileName = extension.isEmpty() || name.toLowerCase(Locale.ROOT).endsWith("." + extension)
            ? name : name + "." + extension;
        sizeBytes = file == null ? 0 : file.optLong("sizeBytes");
        modifiedAt = file == null ? "" : file.optString("modifiedAt");
        image = file != null && (file.optString("mimeType").startsWith("image/")
            || extension.matches("avif|bmp|gif|jpe?g|png|svg|webp"));
    }

    public static FileEntry folder(SharedFolder folder) {
        return new FileEntry(Type.FOLDER, folder, null, null);
    }

    public static FileEntry video(VideoFile video) {
        return new FileEntry(Type.VIDEO, null, video, null);
    }

    public static FileEntry file(JSONObject file) {
        return new FileEntry(Type.FILE, null, null, file);
    }
}

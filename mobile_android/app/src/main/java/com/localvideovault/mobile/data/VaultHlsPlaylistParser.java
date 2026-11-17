package com.localvideovault.mobile.data;

import android.net.Uri;

import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.hls.playlist.DefaultHlsPlaylistParserFactory;
import androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParserFactory;
import androidx.media3.exoplayer.upstream.ParsingLoadable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@UnstableApi
public final class VaultHlsPlaylistParser implements HlsPlaylistParserFactory {
    private static final Pattern AUDIO_URI = Pattern.compile("URI=\"([\\w-]+)/([^/\"?#]+)([?#][^\"]*)?\"");
    private static final Pattern AUDIO_NAME = Pattern.compile("(?<=,)NAME=\"[^\"]*\"");
    private final DefaultHlsPlaylistParserFactory delegate = new DefaultHlsPlaylistParserFactory();
    private final ApiClient api;
    private final String videoId;

    public VaultHlsPlaylistParser(ApiClient api, String videoId) {
        this.api = api;
        this.videoId = videoId;
    }

    @Override
    public ParsingLoadable.Parser<HlsPlaylist> createPlaylistParser() {
        return (uri, input) -> {
            BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8));
            StringBuilder playlist = new StringBuilder();
            Map<String, String> labels = null;
            String line;
            while ((line = reader.readLine()) != null) {
                String entry = line.trim();
                if (entry.startsWith("#EXT-X-MEDIA:TYPE=AUDIO,")) {
                    entry = entry.replace('\\', '/');
                    Matcher match = AUDIO_URI.matcher(entry);
                    if (match.find()) {
                        String trackId = match.group(1);
                        String suffix = match.group(3) == null ? "" : match.group(3);
                        String route = "../audio/" + trackId + "/hls/" + match.group(2) + suffix;
                        entry = match.replaceFirst(Matcher.quoteReplacement("URI=\"" + route + "\""));
                        if (labels == null) labels = readLabels();
                        String label = labels.get(trackId);
                        if (label != null) {
                            // Include the rendition ID so duplicate display names stay distinct.
                            String name = label + " (" + trackId.substring(0, Math.min(8, trackId.length())) + ")";
                            entry = AUDIO_NAME.matcher(entry).replaceFirst(Matcher.quoteReplacement("NAME=\"" + name + "\""));
                        }
                    }
                } else if (entry.startsWith("video/") || entry.startsWith("video\\")) {
                    entry = entry.substring("video/".length());
                }
                playlist.append(entry).append('\n');
            }
            byte[] bytes = playlist.toString().getBytes(StandardCharsets.UTF_8);
            return delegate.createPlaylistParser().parse(uri, new ByteArrayInputStream(bytes));
        };
    }

    @Override
    public ParsingLoadable.Parser<HlsPlaylist> createPlaylistParser(
        HlsMultivariantPlaylist master, HlsMediaPlaylist previous
    ) {
        return delegate.createPlaylistParser(master, previous);
    }

    private Map<String, String> readLabels() {
        Map<String, String> labels = new HashMap<>();
        try {
            JSONArray tracks = api.getArray("/videos/" + Uri.encode(videoId) + "/audio");
            for (int i = 0; i < tracks.length(); i++) {
                JSONObject track = tracks.getJSONObject(i);
                String label = track.optString("title").trim();
                if (label.isEmpty()) label = track.optString("language").trim();
                if (!label.isEmpty()) {
                    labels.put(track.getString("id"), label.replaceAll("[\"\\p{Cntrl}]", " "));
                }
            }
        } catch (Exception ignored) {
            // The manifest still provides selectable audio tracks.
        }
        return labels;
    }
}

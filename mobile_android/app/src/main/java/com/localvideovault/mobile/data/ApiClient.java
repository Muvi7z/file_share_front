package com.localvideovault.mobile.data;

import android.content.Context;
import android.content.ContentResolver;
import android.content.SharedPreferences;
import android.net.Uri;

import com.localvideovault.mobile.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okio.BufferedSink;

public class ApiClient {
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private static final String COOKIE_PREFS_NAME = "vault_auth_cookies";
    private static final String ACCESS_COOKIE_NAME = "access_token";
    private static final String REFRESH_COOKIE_NAME = "refresh_token";

    public interface AuthExpiredListener {
        void onAuthExpired();
    }

    private final String primaryApiBaseUrl;
    private final String primaryServerBaseUrl;
    private final String fallbackApiBaseUrl;
    private final String fallbackServerBaseUrl;
    private volatile String apiBaseUrl;
    private volatile String serverBaseUrl;
    private volatile String apiBasePath;
    private final PersistentCookieJar cookieJar;
    private final OkHttpClient client;
    private final Object refreshLock = new Object();
    private volatile String authToken = "";
    private volatile AuthExpiredListener authExpiredListener = null;

    public ApiClient(Context context) {
        this.primaryApiBaseUrl = stripTrailingSlash(context.getString(R.string.backend_api_base_url).trim());
        this.primaryServerBaseUrl = readServerBaseUrl(primaryApiBaseUrl);
        this.fallbackApiBaseUrl = stripTrailingSlash(context.getString(R.string.backend_api_fallback_url).trim());
        this.fallbackServerBaseUrl = readServerBaseUrl(fallbackApiBaseUrl);
        setActiveEndpoint(primaryApiBaseUrl);

        SharedPreferences cookiePrefs = context.getApplicationContext()
            .getSharedPreferences(COOKIE_PREFS_NAME, Context.MODE_PRIVATE);
        this.cookieJar = new PersistentCookieJar(cookiePrefs);

        this.client = new OkHttpClient.Builder()
            .cookieJar(cookieJar)
            .retryOnConnectionFailure(true)
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(35, TimeUnit.SECONDS)
            .addInterceptor(chain -> {
                Request original = chain.request();
                if (!authToken.isEmpty() && isBackendUrl(original.url().toString())) {
                    original = original.newBuilder()
                        .header("Authorization", "Bearer " + authToken)
                        .build();
                }
                return chain.proceed(original);
            })
            .build();
    }

    public void setAuthExpiredListener(AuthExpiredListener listener) {
        this.authExpiredListener = listener;
    }

    public boolean hasSessionCookies() {
        return cookieJar.hasRefreshCookie() || cookieJar.hasAccessCookie();
    }

    public String cookieHeaderFor(HttpUrl url) {
        if (url == null) return "";
        List<Cookie> cookies = cookieJar.loadForRequest(url);
        if (cookies.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < cookies.size(); i++) {
            if (i > 0) sb.append("; ");
            Cookie c = cookies.get(i);
            sb.append(c.name()).append('=').append(c.value());
        }
        return sb.toString();
    }

    public Request request(String path) {
        return withAuth(new Request.Builder().url(apiUrl(path))).build();
    }

    public JSONArray getArray(String path) throws Exception {
        String body = execute(request(path));
        return new JSONArray(body);
    }

    public JSONObject getObject(String path) throws Exception {
        String body = execute(request(path));
        return new JSONObject(body);
    }

    public JSONObject fetchCurrentUser() throws Exception {
        return postEmpty("/auth/me");
    }

    public JSONObject postEmpty(String path) throws Exception {
        Request request = withAuth(new Request.Builder().url(apiUrl(path)))
            .post(RequestBody.create("", JSON))
            .build();
        return new JSONObject(execute(request));
    }

    public void logout() {
        try {
            Request request = new Request.Builder()
                .url(apiUrl("/auth/logout"))
                .post(RequestBody.create("", JSON))
                .build();
            executeRaw(request, false);
        } catch (Exception ignored) {
            // Clear local cookies even if backend is temporarily unreachable.
        } finally {
            authToken = "";
            cookieJar.clear();
        }
    }

    public String webSocketUrl(String deviceId, String deviceName, String deviceType, boolean useFallback) {
        String base = (useFallback && !fallbackApiBaseUrl.isEmpty()) ? fallbackApiBaseUrl : apiBaseUrl;
        String wsBase = base.startsWith("https://")
            ? "wss://" + base.substring("https://".length())
            : (base.startsWith("http://") ? "ws://" + base.substring("http://".length()) : base);
        return wsBase + "/ws?deviceId=" + Uri.encode(deviceId == null ? "" : deviceId)
            + "&deviceName=" + Uri.encode(deviceName == null ? "" : deviceName)
            + "&deviceType=" + Uri.encode(deviceType == null ? "tv" : deviceType);
    }

    public boolean hasFallbackEndpoint() {
        return !fallbackApiBaseUrl.isEmpty() && !fallbackApiBaseUrl.equals(primaryApiBaseUrl);
    }

    public OkHttpClient webSocketClient() {
        return client.newBuilder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .callTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(25, TimeUnit.SECONDS)
            .build();
    }

    public JSONObject postJson(String path, JSONObject payload) throws Exception {
        return sendJson("POST", path, payload);
    }

    public JSONObject sendJson(String method, String path, JSONObject payload) throws Exception {
        Request request = withAuth(new Request.Builder().url(apiUrl(path)))
            .method(method, RequestBody.create(payload.toString(), JSON))
            .build();
        return new JSONObject(execute(request));
    }

    public void get(String path) throws IOException {
        execute(request(path));
    }

    public void uploadPoster(String path, ContentResolver resolver, Uri image) throws IOException {
        String mime = resolver.getType(image);
        MediaType type = mime == null ? null : MediaType.parse(mime);
        String extension = android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
        RequestBody imageBody = new RequestBody() {
            @Override public MediaType contentType() { return type; }

            @Override public void writeTo(BufferedSink sink) throws IOException {
                try (InputStream input = resolver.openInputStream(image)) {
                    if (input == null) throw new IOException("Не удалось открыть изображение.");
                    byte[] buffer = new byte[16 * 1024];
                    int read;
                    long size = 0;
                    while ((read = input.read(buffer)) != -1) {
                        size += read;
                        if (size > 60L * 1024 * 1024) throw new IOException("Постер больше 60 МБ.");
                        sink.write(buffer, 0, read);
                    }
                }
            }
        };
        RequestBody body = new MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("poster", "poster." + (extension == null ? "img" : extension), imageBody)
            .build();
        execute(request(path).newBuilder().put(body).build());
    }

    public void delete(String path) throws IOException {
        Request request = withAuth(new Request.Builder().url(apiUrl(path)))
            .delete()
            .build();
        execute(request);
    }

    public void setAuthToken(String token) {
        this.authToken = token == null ? "" : token;
    }

    public String absoluteUrl(String value) {
        if (value == null || value.trim().isEmpty()) {
            return "";
        }
        if (value.startsWith("http://") || value.startsWith("https://")) {
            if (!serverBaseUrl.equals(primaryServerBaseUrl) && value.startsWith(primaryServerBaseUrl)) {
                return serverBaseUrl + value.substring(primaryServerBaseUrl.length());
            }
            Uri parsedValue = Uri.parse(value);
            String host = parsedValue.getHost();
            if ("localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host) || "0.0.0.0".equals(host)) {
                String sourceServer = readServerBaseUrl(value);
                return serverBaseUrl + value.substring(sourceServer.length());
            }
            return value;
        }
        if (value.startsWith("/")) {
            if (!apiBasePath.isEmpty() && (value.equals(apiBasePath) || value.startsWith(apiBasePath + "/"))) {
                return serverBaseUrl + value;
            }
            return apiBaseUrl + value;
        }
        return apiBaseUrl + "/" + value;
    }

    public OkHttpClient client() {
        return client;
    }

    private String execute(Request request) throws IOException {
        return executeRaw(request, true);
    }

    private String executeRaw(Request request, boolean allowRefresh) throws IOException {
        try {
            return executeOnce(request, allowRefresh);
        } catch (ApiResponseException error) {
            throw error;
        } catch (IOException primaryError) {
            if (fallbackApiBaseUrl.isEmpty()
                || serverBaseUrl.equals(fallbackServerBaseUrl)
                || !request.url().toString().startsWith(primaryServerBaseUrl)) {
                throw primaryError;
            }

            Request fallbackRequest = rebaseRequest(request, primaryServerBaseUrl, fallbackServerBaseUrl);
            try {
                String result = executeOnce(fallbackRequest, allowRefresh);
                setActiveEndpoint(fallbackApiBaseUrl);
                return result;
            } catch (ApiResponseException error) {
                throw error;
            } catch (IOException fallbackError) {
                IOException combined = new IOException(
                    "Нет подключения к " + primaryServerBaseUrl + " и локальному адресу " + fallbackServerBaseUrl + ".",
                    fallbackError
                );
                combined.addSuppressed(primaryError);
                throw combined;
            }
        }
    }

    private String executeOnce(Request request, boolean allowRefresh) throws IOException {
        String accessBeforeCall = cookieJar.getValue(ACCESS_COOKIE_NAME);
        try (Response response = client.newCall(request).execute()) {
            String body = response.body() == null ? "" : response.body().string();
            if (response.code() == 401
                && allowRefresh
                && !isAuthEndpoint(request.url().encodedPath())
                && cookieJar.hasRefreshCookie()) {
                boolean refreshed = refreshTokensLocked(request.url(), accessBeforeCall);
                if (refreshed) {
                    return executeOnce(request, false);
                }
            }
            if (!response.isSuccessful()) {
                throw new ApiResponseException(response.code(), errorMessage(body, response.code()));
            }
            return body.isEmpty() ? "{}" : body;
        }
    }

    private boolean refreshTokensLocked(HttpUrl failedRequestUrl, String accessBeforeCall) {
        synchronized (refreshLock) {
            // If another thread already rotated the access token while we waited, retry immediately.
            String currentAccess = cookieJar.getValue(ACCESS_COOKIE_NAME);
            if (!currentAccess.isEmpty() && !currentAccess.equals(accessBeforeCall)) {
                return true;
            }
            if (!cookieJar.hasRefreshCookie()) {
                return false;
            }

            String refreshUrl = buildRefreshUrlFor(failedRequestUrl);
            Request refreshRequest = new Request.Builder()
                .url(refreshUrl)
                .post(RequestBody.create("", JSON))
                .build();

            try (Response response = client.newCall(refreshRequest).execute()) {
                if (response.isSuccessful()) {
                    return true;
                }
                if (response.code() == 401 || response.code() == 403) {
                    authToken = "";
                    cookieJar.clear();
                    notifyAuthExpired();
                }
                return false;
            } catch (IOException ignored) {
                return false;
            }
        }
    }

    private String buildRefreshUrlFor(HttpUrl failedUrl) {
        if (failedUrl != null) {
            String full = failedUrl.toString();
            if (!fallbackServerBaseUrl.isEmpty() && full.startsWith(fallbackServerBaseUrl)) {
                return fallbackApiBaseUrl + "/auth/refresh";
            }
            if (full.startsWith(primaryServerBaseUrl)) {
                return primaryApiBaseUrl + "/auth/refresh";
            }
        }
        return apiUrl("/auth/refresh");
    }

    private void notifyAuthExpired() {
        AuthExpiredListener listener = this.authExpiredListener;
        if (listener != null) {
            listener.onAuthExpired();
        }
    }

    private boolean isAuthEndpoint(String path) {
        if (path == null) return false;
        return path.endsWith("/auth/login")
            || path.endsWith("/auth/register")
            || path.endsWith("/auth/refresh")
            || path.endsWith("/auth/logout");
    }

    private Request rebaseRequest(Request request, String fromServer, String toServer) {
        String originalUrl = request.url().toString();
        String fallbackUrl = toServer + originalUrl.substring(fromServer.length());
        return request.newBuilder().url(fallbackUrl).build();
    }

    private synchronized void setActiveEndpoint(String baseUrl) {
        this.apiBaseUrl = stripTrailingSlash(baseUrl);
        this.serverBaseUrl = readServerBaseUrl(apiBaseUrl);
        Uri parsedBaseUrl = Uri.parse(apiBaseUrl);
        String path = parsedBaseUrl.getEncodedPath();
        this.apiBasePath = path == null ? "" : stripTrailingSlash(path);
    }

    private String readServerBaseUrl(String baseUrl) {
        Uri parsedBaseUrl = Uri.parse(baseUrl);
        String scheme = parsedBaseUrl.getScheme();
        String authority = parsedBaseUrl.getEncodedAuthority();
        return scheme == null || authority == null ? baseUrl : scheme + "://" + authority;
    }

    private boolean isBackendUrl(String url) {
        if (url == null) return false;
        return url.startsWith(primaryServerBaseUrl)
            || (!fallbackServerBaseUrl.isEmpty() && url.startsWith(fallbackServerBaseUrl));
    }

    private Request.Builder withAuth(Request.Builder builder) {
        if (!authToken.isEmpty()) {
            builder.header("Authorization", "Bearer " + authToken);
        }
        return builder;
    }

    private String apiUrl(String path) {
        String value = path == null ? "" : path.trim();
        if (value.startsWith("http://") || value.startsWith("https://")) {
            return value;
        }
        if (!value.startsWith("/")) {
            value = "/" + value;
        }
        if (!apiBasePath.isEmpty() && (value.equals(apiBasePath) || value.startsWith(apiBasePath + "/"))) {
            return serverBaseUrl + value;
        }
        return apiBaseUrl + value;
    }

    private String stripTrailingSlash(String value) {
        String result = value;
        while (result.endsWith("/") && result.length() > 1) {
            result = result.substring(0, result.length() - 1);
        }
        return result;
    }

    private String errorMessage(String body, int code) {
        try {
            JSONObject payload = new JSONObject(body);
            String message = payload.optString("message", payload.optString("error", ""));
            if (!message.isEmpty()) {
                return message;
            }
        } catch (Exception ignored) {
            // Use the HTTP status fallback below when the backend response is not JSON.
        }
        return "API error " + code;
    }

    private final class PersistentCookieJar implements CookieJar {
        private static final String KEY_COOKIES = "cookies_json";
        private final SharedPreferences prefs;
        private final Map<String, StoredCookie> store = new HashMap<>();

        PersistentCookieJar(SharedPreferences prefs) {
            this.prefs = prefs;
            loadFromDisk();
        }

        @Override
        public synchronized void saveFromResponse(HttpUrl url, List<Cookie> cookies) {
            if (url == null || cookies == null || !isBackendUrl(url.toString())) {
                return;
            }
            long now = System.currentTimeMillis();
            boolean changed = false;
            for (Cookie cookie : cookies) {
                if (cookie == null || cookie.name().isEmpty()) continue;
                boolean expired = cookie.expiresAt() <= now || cookie.value().isEmpty();
                if (expired) {
                    if (store.remove(cookie.name()) != null) {
                        changed = true;
                    }
                } else {
                    String path = cookie.path();
                    if (path == null || path.isEmpty()) path = "/";
                    store.put(cookie.name(), new StoredCookie(
                        cookie.name(),
                        cookie.value(),
                        path,
                        cookie.expiresAt(),
                        cookie.httpOnly(),
                        cookie.secure()
                    ));
                    changed = true;
                }
            }
            if (changed) {
                persistToDisk();
            }
        }

        @Override
        public synchronized List<Cookie> loadForRequest(HttpUrl url) {
            if (url == null || !isBackendUrl(url.toString()) || store.isEmpty()) {
                return Collections.emptyList();
            }
            long now = System.currentTimeMillis();
            String requestPath = url.encodedPath();
            List<Cookie> result = new ArrayList<>();
            boolean pruned = false;

            Iterator<Map.Entry<String, StoredCookie>> it = store.entrySet().iterator();
            while (it.hasNext()) {
                StoredCookie stored = it.next().getValue();
                if (stored.expiresAt <= now) {
                    it.remove();
                    pruned = true;
                    continue;
                }
                if (stored.secure && !url.isHttps()) {
                    continue;
                }
                if (!pathMatches(requestPath, stored.path)) {
                    continue;
                }
                Cookie.Builder builder = new Cookie.Builder()
                    .name(stored.name)
                    .value(stored.value)
                    .domain(url.host())
                    .path(stored.path)
                    .expiresAt(stored.expiresAt);
                if (stored.httpOnly) builder.httpOnly();
                if (stored.secure) builder.secure();
                result.add(builder.build());
            }

            if (pruned) {
                persistToDisk();
            }
            return result;
        }

        synchronized String getValue(String name) {
            StoredCookie stored = store.get(name);
            if (stored == null || stored.expiresAt <= System.currentTimeMillis()) {
                return "";
            }
            return stored.value;
        }

        synchronized boolean hasAccessCookie() {
            return !getValue(ACCESS_COOKIE_NAME).isEmpty();
        }

        synchronized boolean hasRefreshCookie() {
            return !getValue(REFRESH_COOKIE_NAME).isEmpty();
        }

        synchronized void clear() {
            store.clear();
            prefs.edit().remove(KEY_COOKIES).apply();
        }

        private boolean pathMatches(String requestPath, String cookiePath) {
            if (cookiePath == null || cookiePath.isEmpty() || "/".equals(cookiePath)) {
                return true;
            }
            if (requestPath == null) return false;
            if (requestPath.equals(cookiePath)) return true;
            if (requestPath.startsWith(cookiePath)) {
                return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length()) == '/';
            }
            return false;
        }

        private void loadFromDisk() {
            String raw = prefs.getString(KEY_COOKIES, "");
            if (raw == null || raw.isEmpty()) return;
            long now = System.currentTimeMillis();
            try {
                JSONArray array = new JSONArray(raw);
                for (int i = 0; i < array.length(); i++) {
                    JSONObject obj = array.optJSONObject(i);
                    if (obj == null) continue;
                    String name = obj.optString("name", "");
                    String value = obj.optString("value", "");
                    long expiresAt = obj.optLong("expiresAt", 0L);
                    if (name.isEmpty() || value.isEmpty() || expiresAt <= now) continue;
                    store.put(name, new StoredCookie(
                        name,
                        value,
                        obj.optString("path", "/"),
                        expiresAt,
                        obj.optBoolean("httpOnly", true),
                        obj.optBoolean("secure", false)
                    ));
                }
            } catch (Exception ignored) {
                // Ignore corrupted cookie storage.
            }
        }

        private void persistToDisk() {
            JSONArray array = new JSONArray();
            for (StoredCookie stored : store.values()) {
                try {
                    array.put(new JSONObject()
                        .put("name", stored.name)
                        .put("value", stored.value)
                        .put("path", stored.path)
                        .put("expiresAt", stored.expiresAt)
                        .put("httpOnly", stored.httpOnly)
                        .put("secure", stored.secure));
                } catch (Exception ignored) {
                    // Ignore serialization issue for single entry.
                }
            }
            prefs.edit().putString(KEY_COOKIES, array.toString()).apply();
        }
    }

    private static final class StoredCookie {
        final String name;
        final String value;
        final String path;
        final long expiresAt;
        final boolean httpOnly;
        final boolean secure;

        StoredCookie(String name, String value, String path, long expiresAt, boolean httpOnly, boolean secure) {
            this.name = name;
            this.value = value;
            this.path = path;
            this.expiresAt = expiresAt;
            this.httpOnly = httpOnly;
            this.secure = secure;
        }
    }

    public static final class ApiResponseException extends IOException {
        public final int status;

        ApiResponseException(int status, String message) {
            super(message);
            this.status = status;
        }
    }
}

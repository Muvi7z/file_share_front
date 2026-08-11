package com.localvideovault.mobile.data;

import android.content.Context;
import android.net.Uri;

import com.localvideovault.mobile.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.OkHttpClient;
import okhttp3.Request;

public class ApiClient {
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");

    private final String primaryApiBaseUrl;
    private final String primaryServerBaseUrl;
    private final String fallbackApiBaseUrl;
    private final String fallbackServerBaseUrl;
    private volatile String apiBaseUrl;
    private volatile String serverBaseUrl;
    private volatile String apiBasePath;
    private final OkHttpClient client;
    private volatile String authToken = "";

    public ApiClient(Context context) {
        this.primaryApiBaseUrl = stripTrailingSlash(context.getString(R.string.backend_api_base_url).trim());
        this.primaryServerBaseUrl = readServerBaseUrl(primaryApiBaseUrl);
        this.fallbackApiBaseUrl = stripTrailingSlash(context.getString(R.string.backend_api_fallback_url).trim());
        this.fallbackServerBaseUrl = readServerBaseUrl(fallbackApiBaseUrl);
        setActiveEndpoint(primaryApiBaseUrl);

        this.client = new OkHttpClient.Builder()
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

    public Request request(String path) {
        return withAuth(new Request.Builder().url(apiUrl(path))).build();
    }

    public JSONArray getArray(String path) throws Exception {
        String body = execute(request(path));
        return new JSONArray(body);
    }

    public JSONObject postJson(String path, JSONObject payload) throws Exception {
        Request request = withAuth(new Request.Builder().url(apiUrl(path)))
            .post(RequestBody.create(payload.toString(), JSON))
            .build();
        return new JSONObject(execute(request));
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
        try {
            return executeOnce(request);
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
                String result = executeOnce(fallbackRequest);
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

    private String executeOnce(Request request) throws IOException {
        try (Response response = client.newCall(request).execute()) {
            String body = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                throw new ApiResponseException(errorMessage(body, response.code()));
            }
            return body.isEmpty() ? "{}" : body;
        }
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
        return url.startsWith(primaryServerBaseUrl) || url.startsWith(fallbackServerBaseUrl);
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

    private static final class ApiResponseException extends IOException {
        ApiResponseException(String message) {
            super(message);
        }
    }
}

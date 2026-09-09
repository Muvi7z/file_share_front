package com.localvideovault.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.Matrix;
import android.graphics.Outline;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.text.TextUtils;
import android.util.LruCache;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.DefaultTimeBar;
import androidx.media3.ui.PlayerView;

import com.localvideovault.mobile.data.ApiClient;
import com.localvideovault.mobile.data.VaultRepository;
import com.localvideovault.mobile.model.FileEntry;
import com.localvideovault.mobile.model.SharedFolder;
import com.localvideovault.mobile.model.VideoFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.Request;
import okhttp3.Response;

@UnstableApi
public class MainActivity extends Activity {
    private static final long PLAYER_SEEK_STEP_MS = 5_000L;
    private static final int TV_NAV_COLLAPSED_WIDTH_DP = 82;
    private static final int TV_NAV_EXPANDED_WIDTH_DP = 224;
    private static final int BG = Color.rgb(11, 15, 20);
    private static final int TEXT = Color.rgb(242, 247, 250);
    private static final int MUTED = Color.rgb(183, 194, 189);
    private static final int CARD = Color.argb(116, 78, 91, 85);
    private static final int SURFACE_SELECTED = Color.argb(224, 126, 143, 135);
    private static final int LINE = Color.TRANSPARENT;
    private static final int GREEN = Color.rgb(112, 130, 121);
    private static final int ACCENT = Color.rgb(215, 226, 220);
    private static final int DARK = Color.rgb(22, 28, 25);
    private static final int LIME = Color.rgb(218, 226, 221);
    private static final int WHITE_CONTROL = Color.rgb(241, 244, 241);
    private static final int WHITE_CONTROL_IDLE = Color.argb(214, 241, 244, 241);
    private static final int CATEGORY_IDLE = Color.argb(76, 244, 247, 244);
    private static final int ACTIVE_CONTROL = Color.argb(218, 166, 194, 174);
    private static final int ACTIVE_ICON = Color.rgb(38, 78, 57);

    private final VaultRepository repository = new VaultRepository();
    private final ExecutorService posterExecutor = Executors.newFixedThreadPool(3);
    private final LruCache<String, Bitmap> posterCache = new LruCache<String, Bitmap>(24 * 1024) {
        @Override
        protected int sizeOf(String key, Bitmap value) {
            return Math.max(1, value.getByteCount() / 1024);
        }
    };
    private ApiClient apiClient;
    private LinearLayout root;
    private LinearLayout content;
    private ScrollView mainScrollView;
    private String page = "videos";
    private String viewMode = "grid";
    private String selectedFolderId = "all";
    private String currentDirectoryId = null;
    private String query = "";
    private boolean isAdmin = false;
    private boolean isLoading = false;
    private boolean isEntriesLoading = false;
    private boolean hasLoadedEntries = false;
    private String loadError = "";
    private String entriesError = "";
    private String loadedEntriesDirectoryId = null;
    private int entriesRequestVersion = 0;
    private final List<FileEntry> currentEntries = new ArrayList<>();
    private final List<VideoFile> playbackQueue = new ArrayList<>();
    private int playbackIndex = -1;
    private VideoFile selectedVideo = null;
    private String playerReturnPage = "files";
    private String returnFocusedVideoId = null;
    private int returnScrollY = 0;
    private boolean shouldRestoreListPosition = false;
    private View pendingTvFocus = null;
    private View pendingTvFallbackFocus = null;
    private ExoPlayer player = null;
    private PlayerView playerView = null;
    private ImageView ambientBackground = null;
    private Bitmap glassBackdropBitmap = null;
    private int[] glassOpticalPixels = null;
    private LinearLayout tvNavRail = null;
    private LinearLayout controlsGlassPanel = null;
    private LinearLayout scrollingGlassPanel = null;
    private boolean tvNavExpanded = false;
    private TextView seekFeedbackView = null;
    private View playerMetadataPanel = null;
    private TextView playerTitleView = null;
    private TextView playerSubtitleView = null;
    private long lastPlayerSeekAtMs = 0L;
    private long playerSeekStartedAtMs = 0L;
    private final Runnable hideSeekFeedback = () -> {
        if (seekFeedbackView != null) {
            seekFeedbackView.animate().alpha(0f).setDuration(160L)
                .withEndAction(() -> {
                    if (seekFeedbackView != null) {
                        seekFeedbackView.setVisibility(View.GONE);
                    }
                }).start();
        }
    };
    private final Runnable hidePlayerControls = () -> {
        if (playerView != null && "player".equals(page)) {
            playerView.hideController();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        apiClient = new ApiClient(this);
        enterTvFullscreen();
        refreshData();
    }

    @Override
    protected void onDestroy() {
        releasePlayer();
        posterExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if ("player".equals(page)) {
            closePlayer();
            return;
        }
        if ("files".equals(page) && currentDirectoryId != null) {
            SharedFolder directory = repository.getDirectory(currentDirectoryId);
            currentDirectoryId = directory == null ? null : directory.parentId;
            invalidateDirectoryEntries();
            render();
            return;
        }
        if ("admin".equals(page)) {
            page = "videos";
            render();
            return;
        }
        super.onBackPressed();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if ("player".equals(page) && isTvLayout() && player != null && playerView != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                playerView.showController();
                schedulePlayerControlsHide();
            }
            int keyCode = event.getKeyCode();
            if ((keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT)
                && shouldSeekPlayerFromDpad()) {
                if (event.getAction() == KeyEvent.ACTION_DOWN) {
                    long now = SystemClock.elapsedRealtime();
                    if (playerSeekStartedAtMs == 0L) {
                        playerSeekStartedAtMs = now;
                    }
                    long heldForMs = now - playerSeekStartedAtMs;
                    long repeatIntervalMs = playerSeekRepeatInterval(heldForMs);
                    if (lastPlayerSeekAtMs == 0L || now - lastPlayerSeekAtMs >= repeatIntervalMs) {
                        long stepMs = playerSeekStep(heldForMs);
                        seekPlayerBy(keyCode == KeyEvent.KEYCODE_DPAD_LEFT ? -stepMs : stepMs);
                        showSeekFeedback(keyCode, stepMs, heldForMs);
                        lastPlayerSeekAtMs = now;
                    }
                } else if (event.getAction() == KeyEvent.ACTION_UP) {
                    lastPlayerSeekAtMs = 0L;
                    playerSeekStartedAtMs = 0L;
                }
                return true;
            }
            if (isPlayerToggleKey(keyCode) && shouldTogglePlayerFromDpad()) {
                if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                    if (player.isPlaying()) {
                        player.pause();
                    } else {
                        player.play();
                    }
                    playerView.showController();
                }
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private void schedulePlayerControlsHide() {
        if (playerView == null || !isTvLayout()) {
            return;
        }
        playerView.removeCallbacks(hidePlayerControls);
        playerView.postDelayed(hidePlayerControls, 5_000L);
    }

    private long playerSeekStep(long heldForMs) {
        if (heldForMs >= 3_000L) {
            return 30_000L;
        }
        if (heldForMs >= 1_800L) {
            return 15_000L;
        }
        if (heldForMs >= 800L) {
            return 10_000L;
        }
        return PLAYER_SEEK_STEP_MS;
    }

    private long playerSeekRepeatInterval(long heldForMs) {
        if (heldForMs >= 3_000L) {
            return 70L;
        }
        if (heldForMs >= 1_800L) {
            return 95L;
        }
        if (heldForMs >= 800L) {
            return 125L;
        }
        return 175L;
    }

    private boolean isPlayerToggleKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_DPAD_CENTER
            || keyCode == KeyEvent.KEYCODE_ENTER
            || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
            || keyCode == KeyEvent.KEYCODE_BUTTON_SELECT
            || keyCode == KeyEvent.KEYCODE_BUTTON_A;
    }

    private boolean shouldTogglePlayerFromDpad() {
        View focused = getCurrentFocus();
        return focused == null
            || !focused.isShown()
            || focused == playerView
            || focused.getId() == androidx.media3.ui.R.id.exo_play_pause;
    }

    private boolean shouldSeekPlayerFromDpad() {
        View focused = getCurrentFocus();
        return focused != null
            && focused.isShown()
            && focused.getId() == androidx.media3.ui.R.id.exo_progress;
    }

    private void refreshData() {
        isLoading = true;
        loadError = "";
        render();

        new Thread(() -> {
            try {
                JSONArray folderPayload = apiClient.getArray("/folders");
                JSONArray videoPayload = apiClient.getArray("/videos");
                List<SharedFolder> nextFolders = parseFolders(folderPayload);
                List<VideoFile> nextVideos = parseVideos(videoPayload);
                runOnUiThread(() -> {
                    repository.replaceData(nextFolders, nextVideos);
                    invalidateDirectoryEntries();
                    isLoading = false;
                    loadError = "";
                    render();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    isLoading = false;
                    loadError = error.getMessage() == null ? "Не удалось загрузить данные с API." : error.getMessage();
                    render();
                });
            }
        }).start();
    }

    private List<SharedFolder> parseFolders(JSONArray payload) throws Exception {
        List<SharedFolder> result = new ArrayList<>();
        for (int index = 0; index < payload.length(); index++) {
            result.add(parseFolder(payload.getJSONObject(index)));
        }
        return result;
    }

    private SharedFolder parseFolder(JSONObject item) {
        String id = item.optString("id");
        String parentId = item.isNull("parentId") ? null : item.optString("parentId", null);
        String rootFolderId = item.optString("rootFolderId", id);
        boolean isRoot = item.optBoolean("isRoot", parentId == null);
        return new SharedFolder(
            id,
            item.optString("name", "Папка"),
            item.optString("path", ""),
            parentId,
            rootFolderId,
            isRoot,
            item.optInt("filesCount", 0),
            item.optInt("videoCount", item.optInt("videosCount", 0)),
            item.optInt("childFolderCount", 0),
            item.optBoolean("enabled", true),
            item.optString("lastScanAt", "")
        );
    }

    private List<VideoFile> parseVideos(JSONArray payload) throws Exception {
        List<VideoFile> result = new ArrayList<>();
        for (int index = 0; index < payload.length(); index++) {
            result.add(parseVideo(payload.getJSONObject(index)));
        }
        return result;
    }

    private VideoFile parseVideo(JSONObject item) {
        String id = item.optString("id");
        String streamUrl = item.optString("streamUrl", "");
        if (streamUrl.isEmpty() && !id.isEmpty()) {
            streamUrl = "/videos/" + Uri.encode(id) + "/stream";
        }
        String posterUrl = item.optString("posterUrl", "");
        if (posterUrl.isEmpty() && !id.isEmpty()) {
            posterUrl = "/videos/" + Uri.encode(id) + "/poster";
        }

        long sizeBytes = item.optLong("sizeBytes", 0);
        return new VideoFile(
            id,
            item.optString("title", item.optString("name", "Видео")),
            item.optString("folderId", ""),
            item.optString("folderName", ""),
            item.optString("parentFolderId", item.optString("parentDirectoryId", "")),
            item.optString("size", formatBytes(sizeBytes)),
            sizeBytes,
            readDuration(item),
            item.optString("modifiedAt", ""),
            item.optString("codec", ""),
            item.optString("resolution", ""),
            apiClient.absoluteUrl(posterUrl),
            apiClient.absoluteUrl(streamUrl),
            item.optString("path", "")
        );
    }

    private List<FileEntry> parseFileEntries(JSONArray payload) throws Exception {
        List<FileEntry> result = new ArrayList<>();
        for (int index = 0; index < payload.length(); index++) {
            JSONObject item = payload.getJSONObject(index);
            String type = item.optString("type", "");
            if ("folder".equals(type)) {
                JSONObject folder = item.optJSONObject("folder");
                result.add(FileEntry.folder(parseFolder(folder == null ? item : folder)));
            } else if ("video".equals(type)) {
                JSONObject video = item.optJSONObject("video");
                result.add(FileEntry.video(parseVideo(video == null ? item : video)));
            }
        }
        return result;
    }

    private void invalidateDirectoryEntries() {
        entriesRequestVersion++;
        isEntriesLoading = false;
        hasLoadedEntries = false;
        loadedEntriesDirectoryId = null;
        entriesError = "";
        currentEntries.clear();
    }

    private boolean sameDirectory(String left, String right) {
        return left == null ? right == null : left.equals(right);
    }

    private void ensureDirectoryEntriesLoaded() {
        if (!"files".equals(page) || isEntriesLoading) {
            return;
        }
        if (hasLoadedEntries && sameDirectory(loadedEntriesDirectoryId, currentDirectoryId)) {
            return;
        }
        loadDirectoryEntries(currentDirectoryId);
    }

    private void loadDirectoryEntries(String folderId) {
        final String requestedFolderId = folderId;
        final int requestVersion = ++entriesRequestVersion;
        isEntriesLoading = true;
        entriesError = "";

        new Thread(() -> {
            try {
                String path = requestedFolderId == null
                    ? "/folders/root/entries"
                    : "/folders/" + Uri.encode(requestedFolderId) + "/entries";
                JSONArray payload = apiClient.getArray(path);
                List<FileEntry> nextEntries = parseFileEntries(payload);
                runOnUiThread(() -> {
                    if (requestVersion != entriesRequestVersion || !sameDirectory(requestedFolderId, currentDirectoryId)) {
                        return;
                    }
                    currentEntries.clear();
                    currentEntries.addAll(nextEntries);
                    repository.mergeFileEntries(nextEntries);
                    loadedEntriesDirectoryId = requestedFolderId;
                    hasLoadedEntries = true;
                    isEntriesLoading = false;
                    entriesError = "";
                    render();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestVersion != entriesRequestVersion || !sameDirectory(requestedFolderId, currentDirectoryId)) {
                        return;
                    }
                    currentEntries.clear();
                    isEntriesLoading = false;
                    entriesError = error.getMessage() == null ? "Не удалось загрузить папку." : error.getMessage();
                    render();
                });
            }
        }).start();
    }

    private String readDuration(JSONObject item) {
        Object value = item.opt("duration");
        if (value instanceof Number) {
            return formatDurationSeconds(((Number) value).longValue());
        }
        String textValue = item.optString("duration", "");
        if (textValue.matches("\\d+(\\.\\d+)?")) {
            try {
                return formatDurationSeconds(Math.round(Double.parseDouble(textValue)));
            } catch (NumberFormatException ignored) {
                return textValue;
            }
        }
        return textValue;
    }

    private String formatDurationSeconds(long totalSeconds) {
        long safeSeconds = Math.max(0, totalSeconds);
        long hours = safeSeconds / 3600;
        long minutes = (safeSeconds % 3600) / 60;
        long seconds = safeSeconds % 60;
        if (hours > 0) {
            return String.format("%d:%02d:%02d", hours, minutes, seconds);
        }
        return String.format("%d:%02d", minutes, seconds);
    }

    private String formatBytes(long bytes) {
        if (bytes <= 0) {
            return "";
        }
        String[] units = {"B", "KB", "MB", "GB", "TB"};
        double value = bytes;
        int unit = 0;
        while (value >= 1024 && unit < units.length - 1) {
            value = value / 1024;
            unit++;
        }
        return value >= 10 || unit == 0
            ? String.format("%.0f %s", value, units[unit])
            : String.format("%.1f %s", value, units[unit]);
    }

    private void render() {
        releasePlayer();
        pendingTvFocus = null;
        pendingTvFallbackFocus = null;
        boolean isPlayerPage = "player".equals(page) && selectedVideo != null;
        if (isPlayerPage) {
            enterPlayerFullscreen();
        } else {
            exitPlayerFullscreen();
        }

        if (isPlayerPage) {
            root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setBackgroundColor(Color.BLACK);
            setContentView(root);
            renderPlayerPage();
            return;
        }

        ambientBackground = null;
        tvNavRail = null;
        tvNavExpanded = false;
        scrollingGlassPanel = null;
        if (isTvLandscape()) {
            FrameLayout tvStage = new FrameLayout(this);
            tvStage.setBackgroundColor(BG);
            tvStage.setClipChildren(false);
            tvStage.setClipToPadding(false);
            setContentView(tvStage);
            renderAmbientBackground(tvStage);

            root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setBackgroundColor(Color.TRANSPARENT);
            root.setClipChildren(false);
            root.setClipToPadding(false);
            FrameLayout.LayoutParams contentParams = new FrameLayout.LayoutParams(-1, -1);
            contentParams.leftMargin = dp(TV_NAV_COLLAPSED_WIDTH_DP);
            tvStage.addView(root, contentParams);
            renderTvNavigation(tvStage);
        } else {
            root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setBackgroundColor(BG);
            root.setClipChildren(false);
            root.setClipToPadding(false);
            setContentView(root);
        }

        mainScrollView = new ScrollView(this);
        mainScrollView.setVerticalScrollBarEnabled(false);
        mainScrollView.setFillViewport(true);
        mainScrollView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        mainScrollView.setFocusable(false);
        mainScrollView.setFocusableInTouchMode(false);
        mainScrollView.setClipChildren(false);
        mainScrollView.setClipToPadding(false);
        mainScrollView.setPadding(0, dp(8), 0, dp(8));
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setClipChildren(false);
        content.setClipToPadding(false);
        int sidePadding = isTvLandscape() ? dp(28) : (isTvLayout() ? dp(36) : dp(12));
        int bottomPadding = isTvLandscape() ? dp(28) : dp(isTvLayout() ? 104 : 88);
        content.setPadding(sidePadding, 0, sidePadding, bottomPadding);
        mainScrollView.setOnScrollChangeListener((view, scrollX, scrollY, oldScrollX, oldScrollY) -> {
            if (scrollingGlassPanel != null) {
                scrollingGlassPanel.invalidate();
            }
        });
        mainScrollView.addView(content);
        root.addView(mainScrollView, new LinearLayout.LayoutParams(-1, 0, 1));
        renderHeader();

        if ("admin".equals(page)) {
            renderAdminPage();
        } else {
            renderSearchAndMode();
            if (isLoading) {
                content.addView(statusCard("Загрузка", "Получаем папки и видео с API.", false));
            } else if (!loadError.isEmpty()) {
                content.addView(statusCard("Ошибка API", loadError, true));
            } else if ("files".equals(page)) {
                renderFilesPage();
            } else {
                renderVideosPage();
            }
        }

        renderBottomNav();
        boolean restoringFocus = shouldRestoreListPosition;
        restoreListPositionIfNeeded();
        if (!restoringFocus) {
            focusTvDefaultIfNeeded();
        }
    }

    private void renderAmbientBackground(FrameLayout stage) {
        if (glassBackdropBitmap == null) {
            glassBackdropBitmap = decodeBackdropForScreen(R.drawable.windows_11_green);
            if (glassBackdropBitmap != null) {
                glassOpticalPixels = new int[
                    glassBackdropBitmap.getWidth() * glassBackdropBitmap.getHeight()
                ];
                glassBackdropBitmap.getPixels(
                    glassOpticalPixels,
                    0,
                    glassBackdropBitmap.getWidth(),
                    0,
                    0,
                    glassBackdropBitmap.getWidth(),
                    glassBackdropBitmap.getHeight()
                );
            }
        }
        ambientBackground = new ImageView(this);
        ambientBackground.setScaleType(ImageView.ScaleType.CENTER_CROP);
        ambientBackground.setImageBitmap(glassBackdropBitmap);
        ambientBackground.setAlpha(1f);
        ambientBackground.setFocusable(false);
        ambientBackground.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        stage.addView(ambientBackground, new FrameLayout.LayoutParams(-1, -1));
    }

    private Bitmap decodeBackdropForScreen(int resourceId) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeResource(getResources(), resourceId, bounds);

        int targetWidth = getResources().getDisplayMetrics().widthPixels;
        int targetHeight = getResources().getDisplayMetrics().heightPixels;
        int sampleSize = 1;
        while (bounds.outWidth / (sampleSize * 2) >= targetWidth
            && bounds.outHeight / (sampleSize * 2) >= targetHeight) {
            sampleSize *= 2;
        }

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sampleSize;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        return BitmapFactory.decodeResource(getResources(), resourceId, options);
    }

    private void renderTvNavigation(FrameLayout shell) {
        LinearLayout rail = new LinearLayout(this);
        tvNavRail = rail;
        rail.setOrientation(LinearLayout.VERTICAL);
        rail.setClipChildren(false);
        rail.setClipToPadding(false);
        rail.setGravity(Gravity.CENTER_HORIZONTAL);
        rail.setPadding(dp(12), dp(26), dp(12), dp(24));
        rail.setBackground(makeLensDrawable(Color.TRANSPARENT, 22, false));
        rail.setElevation(dp(26));

        LinearLayout brand = new LinearLayout(this);
        brand.setGravity(Gravity.CENTER);
        brand.setPadding(0, 0, 0, 0);
        brand.setTag("nav-row");
        ImageView brandIcon = new ImageView(this);
        brandIcon.setImageResource(R.drawable.ic_brand_tv);
        brandIcon.clearColorFilter();
        brandIcon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        brandIcon.setPadding(dp(4), dp(4), dp(4), dp(4));
        brandIcon.setBackgroundColor(Color.TRANSPARENT);
        brand.addView(brandIcon, new LinearLayout.LayoutParams(dp(48), dp(48)));
        TextView brandTitle = text("VIDEO VAULT", 14, TEXT, true);
        brandTitle.setSingleLine(true);
        brandTitle.setAlpha(0f);
        brandTitle.setVisibility(View.GONE);
        brandTitle.setPadding(dp(14), 0, 0, 0);
        brandTitle.setTag("nav-label");
        brand.addView(brandTitle, new LinearLayout.LayoutParams(0, dp(44), 1));
        rail.addView(brand, new LinearLayout.LayoutParams(-1, dp(48)));
        addSpace(rail, 30);

        LinearLayout videosButton = navRailButton("Видео", "videos", R.drawable.ic_video_tv);
        LinearLayout filesButton = navRailButton("Файлы", "files", R.drawable.ic_folder_tv);
        LinearLayout adminButton = navRailButton("Админ", "admin", R.drawable.ic_admin_tv);

        videosButton.setNextFocusUpId(adminButton.getId());
        videosButton.setNextFocusDownId(filesButton.getId());
        filesButton.setNextFocusUpId(videosButton.getId());
        filesButton.setNextFocusDownId(adminButton.getId());
        adminButton.setNextFocusUpId(filesButton.getId());
        adminButton.setNextFocusDownId(videosButton.getId());

        rail.addView(videosButton);
        addSpace(rail, 8);
        rail.addView(filesButton);

        View spacer = new View(this);
        rail.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1));
        rail.addView(adminButton);

        FrameLayout.LayoutParams railParams = new FrameLayout.LayoutParams(dp(TV_NAV_COLLAPSED_WIDTH_DP), -1, Gravity.LEFT);
        railParams.setMargins(dp(10), dp(10), 0, dp(10));
        shell.addView(rail, railParams);
    }

    private LinearLayout navRailButton(String label, String targetPage, int iconResource) {
        boolean selected = targetPage.equals(page);
        LinearLayout button = new LinearLayout(this);
        button.setOrientation(LinearLayout.HORIZONTAL);
        button.setGravity(Gravity.CENTER);
        button.setPadding(0, 0, 0, 0);
        button.setTag("nav-row");
        button.setFocusable(true);
        button.setFocusableInTouchMode(true);
        button.setId(View.generateViewId());
        button.setNextFocusLeftId(button.getId());
        button.setSelected(selected);
        button.setContentDescription(label);

        ImageView icon = new ImageView(this);
        icon.setImageResource(iconResource);
        icon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        button.addView(icon, new LinearLayout.LayoutParams(dp(26), dp(26)));

        TextView title = text(label, 14, selected ? TEXT : MUTED, true);
        title.setGravity(Gravity.CENTER_VERTICAL);
        title.setMaxLines(1);
        title.setAlpha(0f);
        title.setVisibility(View.GONE);
        title.setPadding(dp(16), 0, 0, 0);
        title.setTag("nav-label");
        button.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));

        updateNavRailFocus(button, icon, title, selected, false);
        button.setOnFocusChangeListener((view, hasFocus) -> {
            updateNavRailFocus((LinearLayout) view, icon, title, selected, hasFocus);
            if (hasFocus) {
                setTvNavigationExpanded(true);
            } else if (tvNavRail != null) {
                tvNavRail.postDelayed(() -> {
                    if (tvNavRail != null && !tvNavRail.hasFocus()) {
                        setTvNavigationExpanded(false);
                    }
                }, 70L);
            }
        });
        button.setOnClickListener(v -> {
            page = targetPage;
            selectedVideo = null;
            render();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(54));
        params.setMargins(0, 0, 0, dp(8));
        button.setLayoutParams(params);
        return button;
    }

    private void updateNavRailFocus(
        LinearLayout button,
        ImageView icon,
        TextView title,
        boolean selected,
        boolean hasFocus
    ) {
        int background = hasFocus
            ? WHITE_CONTROL
            : (selected ? ACTIVE_CONTROL : Color.TRANSPARENT);
        button.setBackground(makeRoundDrawable(background, 0, 13));
        title.setTextColor(hasFocus || selected ? DARK : TEXT);
        icon.setColorFilter(hasFocus ? DARK : (selected ? ACTIVE_ICON : TEXT));
        button.setScaleX(1f);
        button.setScaleY(1f);
        button.setTranslationY(0);
        button.setElevation(hasFocus ? dp(12) : 0);
    }

    private void setTvNavigationExpanded(boolean expanded) {
        if (tvNavRail == null) {
            return;
        }
        if (tvNavExpanded == expanded) {
            return;
        }
        tvNavExpanded = expanded;
        ViewGroup.LayoutParams params = tvNavRail.getLayoutParams();
        int targetWidth = dp(expanded ? TV_NAV_EXPANDED_WIDTH_DP : TV_NAV_COLLAPSED_WIDTH_DP);
        if (params.width == targetWidth) {
            updateNavigationLabels(expanded);
            return;
        }
        params.width = targetWidth;
        tvNavRail.setLayoutParams(params);
        updateNavigationLabels(expanded);
        if (tvNavRail.getBackground() instanceof RefractiveGlassDrawable) {
            ((RefractiveGlassDrawable) tvNavRail.getBackground()).invalidateOpticalCache();
        }
    }

    private void updateNavigationLabels(boolean visible) {
        if (tvNavRail == null) {
            return;
        }
        for (int index = 0; index < tvNavRail.getChildCount(); index++) {
            View child = tvNavRail.getChildAt(index);
            if (!(child instanceof ViewGroup)) {
                continue;
            }
            ViewGroup group = (ViewGroup) child;
            if ("nav-row".equals(group.getTag()) && group instanceof LinearLayout) {
                LinearLayout navRow = (LinearLayout) group;
                navRow.setGravity(visible ? Gravity.CENTER_VERTICAL : Gravity.CENTER);
                navRow.setPadding(visible ? dp(9) : 0, 0, visible ? dp(9) : 0, 0);
            }
            for (int innerIndex = 0; innerIndex < group.getChildCount(); innerIndex++) {
                View candidate = group.getChildAt(innerIndex);
                if ("nav-label".equals(candidate.getTag())) {
                    candidate.animate().cancel();
                    if (visible) {
                        candidate.setAlpha(1f);
                        candidate.setVisibility(View.VISIBLE);
                    } else {
                        candidate.setAlpha(0f);
                        candidate.setVisibility(View.GONE);
                    }
                }
            }
        }
    }

    private View statusCard(String title, String message, boolean withRetry) {
        LinearLayout card = card();
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        card.addView(text(title, isTvLayout() ? 22 : 18, TEXT, true));
        card.addView(text(message, isTvLayout() ? 16 : 14, MUTED, false));

        if (withRetry) {
            addSpace(card, 12);
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);

            TextView retry = actionButton("Повторить", GREEN, Color.WHITE);
            retry.setOnClickListener(v -> refreshData());
            row.addView(retry, new LinearLayout.LayoutParams(-1, dp(isTvLandscape() ? 42 : (isTvLayout() ? 48 : 42))));
            card.addView(row);
        }

        return withBottomMargin(card, 12);
    }

    private void renderHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        int topPadding = isTvLandscape() ? dp(20) : dp(isTvLayout() ? 22 : 12);
        int bottomPadding = isTvLandscape() ? dp(12) : dp(isTvLayout() ? 12 : 6);
        header.setPadding(0, topPadding, 0, bottomPadding);

        LinearLayout titleBox = new LinearLayout(this);
        titleBox.setOrientation(LinearLayout.VERTICAL);
        if (!isTvLandscape()) {
            titleBox.addView(text("VIDEO VAULT", isTvLayout() ? 13 : 11, MUTED, true));
        }
        titleBox.addView(text(pageTitle(), isTvLandscape() ? 28 : (isTvLayout() ? 34 : 26), TEXT, true));
        header.addView(titleBox, new LinearLayout.LayoutParams(0, -2, 1));

        content.addView(header);
    }

    private String pageTitle() {
        if ("files".equals(page)) {
            return "Все файлы";
        }
        if ("admin".equals(page)) {
            return "Админка";
        }
        return "Видео";
    }

    private void renderSearchAndMode() {
        controlsGlassPanel = new LinearLayout(this);
        controlsGlassPanel.setOrientation(LinearLayout.VERTICAL);
        controlsGlassPanel.setClipChildren(false);
        controlsGlassPanel.setClipToPadding(false);
        controlsGlassPanel.setPadding(dp(16), dp(18), dp(16), dp(16));
        controlsGlassPanel.setBackground(makeLensDrawable(Color.TRANSPARENT, 22, false));
        controlsGlassPanel.setElevation(dp(10));

        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setClipChildren(false);
        row.setClipToPadding(false);
        row.setPadding(0, 0, 0, 0);

        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setText(query);
        input.setHint("files".equals(page) ? "Поиск папок и видео" : "Поиск видео");
        input.setTextSize(isTvLandscape() ? 14 : (isTvLayout() ? 18 : 15));
        input.setTextColor(DARK);
        input.setHintTextColor(Color.rgb(94, 104, 99));
        input.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        input.setPadding(dp(14), 0, dp(14), 0);
        input.setCompoundDrawablePadding(dp(10));
        Drawable searchIcon = getDrawable(R.drawable.ic_search_tv);
        if (searchIcon != null) {
            searchIcon.setTint(DARK);
            searchIcon.setBounds(0, 0, dp(21), dp(21));
            input.setCompoundDrawables(searchIcon, null, null, null);
        }
        input.setBackground(makeRoundDrawable(WHITE_CONTROL, 0, 18));
        input.setOnEditorActionListener((v, actionId, event) -> {
            query = input.getText().toString();
            render();
            return true;
        });
        input.setOnFocusChangeListener((v, hasFocus) -> {
            input.setTranslationY(0);
            input.setElevation(hasFocus ? dp(12) : 0);
            input.setHintTextColor(hasFocus ? DARK : Color.rgb(94, 104, 99));
            if (!hasFocus) {
                query = input.getText().toString();
            }
        });
        row.addView(input, new LinearLayout.LayoutParams(0, dp(isTvLandscape() ? 48 : (isTvLayout() ? 58 : 46)), 1));

        addInlineSpace(row, 12);
        row.addView(modeButton(R.drawable.ic_grid_tv, "grid"));
        addInlineSpace(row, 6);
        row.addView(modeButton(R.drawable.ic_list_tv, "list"));
        controlsGlassPanel.addView(row);
        content.addView(withBottomMargin(controlsGlassPanel, isTvLandscape() ? 14 : 10));
    }

    private ImageView modeButton(int iconResource, String mode) {
        boolean selected = mode.equals(viewMode);
        ImageView button = new ImageView(this);
        button.setImageResource(iconResource);
        button.setContentDescription("grid".equals(mode) ? "Сетка" : "Список");
        button.setSelected(selected);
        button.setScaleType(ImageView.ScaleType.CENTER);
        button.setPadding(dp(11), dp(11), dp(11), dp(11));
        button.setFocusable(true);
        button.setFocusableInTouchMode(isTvLayout());
        updateModeButton(button, selected, false);
        button.setOnFocusChangeListener((view, hasFocus) -> updateModeButton((ImageView) view, selected, hasFocus));
        button.setOnClickListener(v -> {
            viewMode = mode;
            render();
        });
        int size = isTvLandscape() ? 44 : (isTvLayout() ? 56 : 42);
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(size), dp(size)));
        return button;
    }

    private void updateModeButton(ImageView button, boolean selected, boolean hasFocus) {
        button.setBackground(makeRoundDrawable(
            hasFocus ? Color.WHITE : (selected ? ACTIVE_CONTROL : CATEGORY_IDLE),
            0,
            12
        ));
        button.setColorFilter(hasFocus ? DARK : (selected ? ACTIVE_ICON : DARK));
        button.setScaleX(1f);
        button.setScaleY(1f);
        button.setTranslationY(0);
        button.setElevation(hasFocus ? dp(10) : 0);
    }

    private void renderVideosPage() {
        renderFolderChips();
        List<VideoFile> list = repository.getVideos(selectedFolderId, query);
        LinearLayout listPanel = glassContentPanel();
        content.addView(listPanel);
        if ("grid".equals(viewMode)) {
            renderVideoGrid(list, listPanel);
        } else {
            for (VideoFile video : list) {
                View card = videoCard(video, false);
                rememberTvFocus(card);
                listPanel.addView(card);
            }
        }
    }

    private void renderFolderChips() {
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setClipChildren(false);
        scroll.setClipToPadding(false);
        scroll.setPadding(dp(10), dp(14), dp(10), dp(14));
        scroll.setFocusable(false);
        scroll.setFocusableInTouchMode(false);
        LinearLayout row = new LinearLayout(this);
        row.setPadding(0, 0, 0, 0);
        TextView all = chip("Все", "all".equals(selectedFolderId));
        all.setOnClickListener(v -> {
            selectedFolderId = "all";
            page = "videos";
            render();
        });
        row.addView(all);
        for (SharedFolder folder : repository.getEnabledFolders()) {
            TextView chip = chip(folder.name, folder.id.equals(selectedFolderId));
            chip.setOnClickListener(v -> {
                selectedFolderId = folder.id;
                page = "videos";
                render();
            });
            row.addView(chip);
        }
        scroll.addView(row);
        (controlsGlassPanel == null ? content : controlsGlassPanel).addView(scroll);
    }

    private void renderFilesPage() {
        renderBreadcrumbs();
        ensureDirectoryEntriesLoaded();
        List<FileEntry> entries = filterEntries(currentEntries, query);
        renderCompactSummary(entries);

        if (isEntriesLoading) {
            content.addView(statusCard("Загрузка", "Получаем содержимое папки с API.", false));
            return;
        }

        if (!entriesError.isEmpty()) {
            content.addView(statusCard("Ошибка папки", entriesError, true));
            return;
        }

        if (entries.isEmpty()) {
            content.addView(emptyCard());
            return;
        }

        LinearLayout listPanel = glassContentPanel();
        content.addView(listPanel);
        if ("grid".equals(viewMode)) {
            renderEntryGrid(entries, listPanel);
        } else {
            for (FileEntry entry : entries) {
                View card = entry.type == FileEntry.Type.FOLDER ? folderCard(entry.folder, false) : videoCard(entry.video, false);
                rememberTvFocus(card);
                listPanel.addView(card);
            }
        }
    }

    private List<FileEntry> filterEntries(List<FileEntry> entries, String searchQuery) {
        String normalized = searchQuery == null ? "" : searchQuery.trim().toLowerCase();
        if (normalized.isEmpty()) {
            return new ArrayList<>(entries);
        }

        List<FileEntry> result = new ArrayList<>();
        for (FileEntry entry : entries) {
            if (entry.type == FileEntry.Type.FOLDER && entry.folder != null) {
                String haystack = (entry.folder.name + " " + entry.folder.path).toLowerCase();
                if (haystack.contains(normalized)) {
                    result.add(entry);
                }
            } else if (entry.video != null) {
                String haystack = (entry.video.title + " " + entry.video.folderName + " " + entry.video.codec + " "
                    + entry.video.resolution + " " + entry.video.path).toLowerCase();
                if (haystack.contains(normalized)) {
                    result.add(entry);
                }
            }
        }
        return result;
    }

    private void renderBreadcrumbs() {
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setClipChildren(false);
        scroll.setClipToPadding(false);
        scroll.setPadding(dp(10), dp(14), dp(10), dp(14));
        scroll.setFocusable(false);
        scroll.setFocusableInTouchMode(false);
        LinearLayout row = new LinearLayout(this);
        row.setPadding(0, 0, 0, 0);

        TextView rootChip = chip("Все папки", currentDirectoryId == null);
        rootChip.setOnClickListener(v -> {
            currentDirectoryId = null;
            invalidateDirectoryEntries();
            render();
        });
        row.addView(rootChip);

        for (SharedFolder directory : repository.getBreadcrumbs(currentDirectoryId)) {
            TextView crumb = chip(directory.name, directory.id.equals(currentDirectoryId));
            crumb.setOnClickListener(v -> {
                currentDirectoryId = directory.id;
                invalidateDirectoryEntries();
                render();
            });
            row.addView(crumb);
        }
        scroll.addView(row);
        (controlsGlassPanel == null ? content : controlsGlassPanel).addView(scroll);
    }

    private void renderCompactSummary(List<FileEntry> entries) {
        int folders = 0;
        int videos = 0;
        for (FileEntry entry : entries) {
            if (entry.type == FileEntry.Type.FOLDER) {
                folders++;
            } else {
                videos++;
            }
        }
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(10), 0, dp(10), 0);
        row.setBackground(makeRoundDrawable(CARD, LINE, 8));
        SharedFolder currentDirectory = repository.getDirectory(currentDirectoryId);
        String current = currentDirectoryId == null ? "Корень" : (currentDirectory == null ? "Папка" : currentDirectory.name);
        row.addView(text(current, isTvLandscape() ? 13 : 14, TEXT, true), new LinearLayout.LayoutParams(0, dp(isTvLandscape() ? 30 : 36), 1));
        row.addView(text(folders + " папок  " + videos + " видео", 12, MUTED, true));
        content.addView(withBottomMargin(row, 8));
    }

    private void renderVideoGrid(List<VideoFile> videos, LinearLayout parent) {
        int columns = gridColumns();
        LinearLayout row = null;
        for (int i = 0; i < videos.size(); i++) {
            int column = i % columns;
            if (column == 0) {
                row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setClipChildren(false);
                row.setClipToPadding(false);
                row.setPadding(0, dp(7), 0, dp(9));
                parent.addView(withBottomMargin(row, isTvLandscape() ? 6 : (isTvLayout() ? 8 : 4)));
            }
            View card = videoCard(videos.get(i), true);
            rememberTvFocus(card);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -2, 1);
            params.setMargins(column == 0 ? 0 : dp(8), 0, column == columns - 1 ? 0 : dp(8), 0);
            row.addView(card, params);
        }
        fillGridTail(row, videos.size(), columns);
    }

    private void renderEntryGrid(List<FileEntry> entries, LinearLayout parent) {
        int columns = gridColumns();
        LinearLayout row = null;
        for (int i = 0; i < entries.size(); i++) {
            int column = i % columns;
            if (column == 0) {
                row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setClipChildren(false);
                row.setClipToPadding(false);
                row.setPadding(0, dp(7), 0, dp(9));
                parent.addView(withBottomMargin(row, isTvLandscape() ? 6 : (isTvLayout() ? 8 : 4)));
            }
            FileEntry entry = entries.get(i);
            View card = entry.type == FileEntry.Type.FOLDER ? folderCard(entry.folder, true) : videoCard(entry.video, true);
            rememberTvFocus(card);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -2, 1);
            params.setMargins(column == 0 ? 0 : dp(8), 0, column == columns - 1 ? 0 : dp(8), 0);
            row.addView(card, params);
        }
        fillGridTail(row, entries.size(), columns);
    }

    private View videoCard(VideoFile video, boolean compact) {
        LinearLayout card = mediaCard();
        card.setTag("video:" + video.id);
        card.setContentDescription("Открыть видео: " + video.title
            + (video.duration == null || video.duration.isEmpty() ? "" : ", " + video.duration));
        card.setOnClickListener(v -> openPlayer(video));

        FrameLayout poster = compact ? new SixteenNineFrameLayout(this) : new FrameLayout(this);
        poster.setBackground(makeRoundDrawable(Color.rgb(22, 28, 34), 0, 8));
        poster.setClipToOutline(true);
        ImageView posterImage = new ImageView(this);
        posterImage.setScaleType(ImageView.ScaleType.CENTER_CROP);
        posterImage.setAlpha(0f);
        poster.addView(posterImage, new FrameLayout.LayoutParams(-1, -1));
        loadPosterInto(posterImage, video);

        TextView duration = pill(video.duration, true);
        FrameLayout.LayoutParams durationParams = new FrameLayout.LayoutParams(-2, dp(compact ? 26 : 30), Gravity.BOTTOM | Gravity.RIGHT);
        durationParams.setMargins(0, 0, dp(8), dp(8));
        poster.addView(duration, durationParams);
        int posterHeight = isTvLandscape() ? 148 : (isTvLayout() ? 210 : 158);
        card.addView(poster, new LinearLayout.LayoutParams(-1, compact ? -2 : dp(posterHeight)));

        LinearLayout info = new LinearLayout(this);
        info.setOrientation(LinearLayout.VERTICAL);
        info.setPadding(dp(compact ? (isTvLandscape() ? 8 : (isTvLayout() ? 12 : 9)) : (isTvLandscape() ? 10 : 14)), dp(compact ? (isTvLandscape() ? 7 : (isTvLayout() ? 10 : 8)) : (isTvLandscape() ? 9 : 12)), dp(compact ? (isTvLandscape() ? 8 : (isTvLayout() ? 12 : 9)) : (isTvLandscape() ? 10 : 14)), dp(compact ? (isTvLandscape() ? 8 : (isTvLayout() ? 12 : 9)) : (isTvLandscape() ? 10 : 14)));
        if (compact) {
            info.setMinimumHeight(dp(compactInfoMinHeight()));
        }
        TextView title = text(video.title, compact ? (isTvLandscape() ? 14 : (isTvLayout() ? 16 : 14)) : (isTvLandscape() ? 15 : 17), TEXT, true);
        title.setMaxLines(2);
        title.setEllipsize(TextUtils.TruncateAt.END);
        info.addView(title);
        info.addView(text(compact ? video.size : video.folderName + " • " + video.size, 12, MUTED, false));
        card.addView(info);
        applyMediaCardFocus(card, poster, title);
        return compact ? card : withBottomMargin(card, 10);
    }

    private void loadPosterInto(ImageView image, VideoFile video) {
        String posterUrl = video.posterUrl == null ? "" : video.posterUrl.trim();
        if (posterUrl.isEmpty()) {
            return;
        }

        Bitmap cached = posterCache.get(posterUrl);
        image.setTag(posterUrl);
        if (cached != null) {
            image.setImageBitmap(cached);
            image.setAlpha(1f);
            return;
        }

        posterExecutor.execute(() -> {
            try (Response response = apiClient.client().newCall(new Request.Builder().url(posterUrl).build()).execute()) {
                if (!response.isSuccessful() || response.body() == null) {
                    return;
                }
                byte[] posterBytes = response.body().bytes();
                Bitmap bitmap = decodePoster(posterBytes);
                if (bitmap == null) {
                    return;
                }
                posterCache.put(posterUrl, bitmap);
                runOnUiThread(() -> {
                    Object tag = image.getTag();
                    if (posterUrl.equals(tag)) {
                        image.setImageBitmap(bitmap);
                        image.animate().alpha(1f).setDuration(160).start();
                    }
                });
            } catch (Exception ignored) {
                // Keep the neutral poster placeholder when an image cannot be loaded.
            }
        });
    }

    private Bitmap decodePoster(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            return null;
        }
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);

        int targetWidth = dp(isTvLayout() ? 360 : 240);
        int targetHeight = Math.round(targetWidth * 9f / 16f);
        int sampleSize = 1;
        while (bounds.outWidth / (sampleSize * 2) >= targetWidth
            && bounds.outHeight / (sampleSize * 2) >= targetHeight) {
            sampleSize *= 2;
        }

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sampleSize;
        options.inPreferredConfig = Bitmap.Config.RGB_565;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
    }

    private void openPlayer(VideoFile video) {
        playerReturnPage = "player".equals(page) ? "files" : page;
        returnFocusedVideoId = video.id;
        returnScrollY = mainScrollView == null ? 0 : mainScrollView.getScrollY();
        shouldRestoreListPosition = false;
        preparePlaybackQueue(video);
        selectedVideo = video;
        page = "player";
        render();
    }

    private void preparePlaybackQueue(VideoFile selected) {
        playbackQueue.clear();
        playbackIndex = -1;

        if ("files".equals(page)) {
            for (FileEntry entry : filterEntries(currentEntries, query)) {
                if (entry.type == FileEntry.Type.VIDEO && entry.video != null) {
                    playbackQueue.add(entry.video);
                }
            }
        } else {
            playbackQueue.addAll(repository.getVideos(selectedFolderId, query));
        }

        for (int index = 0; index < playbackQueue.size(); index++) {
            if (playbackQueue.get(index).id.equals(selected.id)) {
                playbackIndex = index;
                break;
            }
        }
        if (playbackIndex < 0) {
            playbackQueue.add(selected);
            playbackIndex = playbackQueue.size() - 1;
        }
    }

    private void closePlayer() {
        releasePlayer();
        page = playerReturnPage;
        selectedVideo = null;
        playbackQueue.clear();
        playbackIndex = -1;
        shouldRestoreListPosition = true;
        render();
    }

    private void restoreListPositionIfNeeded() {
        if (!shouldRestoreListPosition || mainScrollView == null) {
            return;
        }

        shouldRestoreListPosition = false;
        final int scrollY = returnScrollY;
        final String focusedVideoId = returnFocusedVideoId;

        mainScrollView.post(() -> mainScrollView.post(() -> {
            mainScrollView.scrollTo(0, scrollY);
            if (focusedVideoId != null) {
                View focusedCard = root.findViewWithTag("video:" + focusedVideoId);
                if (focusedCard != null) {
                    focusedCard.requestFocus();
                    focusedCard.post(() -> mainScrollView.scrollTo(0, scrollY));
                }
            }
        }));
    }

    private View folderCard(SharedFolder directory, boolean compact) {
        if (compact) {
            return folderGridCard(directory);
        }

        LinearLayout card = card();
        card.setContentDescription("Открыть папку: " + directory.name);
        applyFocus(card, CARD, LIME, 8, Color.TRANSPARENT);
        int cardPadding = isTvLandscape() ? 12 : 14;
        card.setPadding(dp(cardPadding), dp(cardPadding), dp(cardPadding), dp(cardPadding));
        card.setOnClickListener(v -> {
            currentDirectoryId = directory.id;
            invalidateDirectoryEntries();
            render();
        });

        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.ic_folder_tv);
        icon.setScaleType(ImageView.ScaleType.CENTER);
        icon.setColorFilter(ACCENT);
        icon.setBackground(makeRoundDrawable(Color.argb(44, 117, 201, 232), 0, 8));
        int iconSize = isTvLandscape() ? 42 : 50;
        int iconPadding = 10;
        icon.setPadding(dp(iconPadding), dp(iconPadding), dp(iconPadding), dp(iconPadding));
        row.addView(icon, new LinearLayout.LayoutParams(dp(iconSize), dp(iconSize)));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.setPadding(dp(10), 0, 0, 0);
        copy.addView(text(directory.name, compact ? (isTvLandscape() ? 13 : (isTvLayout() ? 16 : 14)) : (isTvLandscape() ? 15 : 17), TEXT, true));
        if (!compact) {
            copy.addView(text(directory.path, 12, MUTED, false));
        }
        row.addView(copy, new LinearLayout.LayoutParams(0, -2, 1));
        card.addView(row);

        String meta = directory.videoCount + " видео";
        meta = directory.childFolderCount + " папок • " + meta;
        if (directory.childFolderCount == 0 && directory.videoCount == 0) {
            meta += " • пустая";
        }
        card.addView(text(meta, 12, MUTED, false));
        return withBottomMargin(card, 10);
    }

    private View folderGridCard(SharedFolder directory) {
        LinearLayout card = mediaCard();
        card.setTag("folder:" + directory.id);
        card.setContentDescription("Открыть папку: " + directory.name);
        card.setOnClickListener(v -> {
            currentDirectoryId = directory.id;
            invalidateDirectoryEntries();
            render();
        });

        FrameLayout poster = new SixteenNineFrameLayout(this);
        poster.setBackground(makeRoundDrawable(Color.rgb(22, 28, 34), 0, 8));
        poster.setClipToOutline(true);

        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.ic_folder_tv);
        icon.setColorFilter(ACCENT);
        icon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        icon.setPadding(dp(12), dp(12), dp(12), dp(12));
        icon.setBackgroundColor(Color.TRANSPARENT);
        int iconSize = isTvLandscape() ? 64 : (isTvLayout() ? 82 : 64);
        FrameLayout.LayoutParams iconParams = new FrameLayout.LayoutParams(dp(iconSize), dp(iconSize), Gravity.CENTER);
        poster.addView(icon, iconParams);

        TextView count = pill(directory.videoCount + " видео", true);
        FrameLayout.LayoutParams countParams = new FrameLayout.LayoutParams(-2, dp(26), Gravity.BOTTOM | Gravity.RIGHT);
        countParams.setMargins(0, 0, dp(8), dp(8));
        poster.addView(count, countParams);
        card.addView(poster, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout info = new LinearLayout(this);
        info.setOrientation(LinearLayout.VERTICAL);
        info.setMinimumHeight(dp(compactInfoMinHeight()));
        info.setPadding(dp(isTvLandscape() ? 8 : (isTvLayout() ? 12 : 9)), dp(isTvLandscape() ? 7 : (isTvLayout() ? 10 : 8)), dp(isTvLandscape() ? 8 : (isTvLayout() ? 12 : 9)), dp(isTvLandscape() ? 8 : (isTvLayout() ? 10 : 9)));
        TextView name = text(directory.name, isTvLandscape() ? 13 : (isTvLayout() ? 16 : 14), TEXT, true);
        name.setMaxLines(2);
        name.setEllipsize(TextUtils.TruncateAt.END);
        info.addView(name);
        String meta = directory.childFolderCount + " папок";
        if (directory.childFolderCount == 0 && directory.videoCount == 0) {
            meta = "Пустая";
        }
        info.addView(text(meta, 12, MUTED, false));
        card.addView(info);
        applyMediaCardFocus(card, poster, name);
        return card;
    }

    private int compactInfoMinHeight() {
        return isTvLandscape() ? 62 : (isTvLayout() ? 82 : 68);
    }

    private View emptyCard() {
        LinearLayout card = card();
        card.setGravity(Gravity.CENTER);
        card.setPadding(dp(20), dp(isTvLandscape() ? 22 : 34), dp(20), dp(isTvLandscape() ? 22 : 34));
        card.addView(text("Папка пустая", 20, TEXT, true));
        card.addView(text("Внутри нет вложенных папок и видео.", 14, MUTED, false));
        return card;
    }

    private void renderAdminPage() {
        if (!isAdmin) {
            renderLoginPage();
            return;
        }

        LinearLayout form = card();
        form.setPadding(dp(isTvLandscape() ? 12 : 14), dp(isTvLandscape() ? 12 : 14), dp(isTvLandscape() ? 12 : 14), dp(isTvLandscape() ? 12 : 14));
        EditText path = input("Путь к папке", "D:\\Video");
        form.addView(path, new LinearLayout.LayoutParams(-1, dp(44)));
        addSpace(form, 10);
        TextView add = actionButton("Добавить папку", GREEN, Color.WHITE);
        add.setOnClickListener(v -> {
            addFolder(path.getText().toString());
        });
        form.addView(add, new LinearLayout.LayoutParams(-1, dp(44)));
        content.addView(withBottomMargin(form, 12));

        for (SharedFolder folder : repository.getFolders()) {
            content.addView(adminFolderCard(folder));
        }

        TextView logout = actionButton("Выйти", CARD, TEXT);
        logout.setOnClickListener(v -> {
            isAdmin = false;
            render();
        });
        content.addView(withBottomMargin(logout, 12));
    }

    private void renderLoginPage() {
        LinearLayout form = card();
        form.setPadding(dp(isTvLandscape() ? 12 : 14), dp(isTvLandscape() ? 12 : 14), dp(isTvLandscape() ? 12 : 14), dp(isTvLandscape() ? 12 : 14));
        EditText login = input("Логин", "admin");
        EditText password = input("Пароль", "");
        form.addView(login, new LinearLayout.LayoutParams(-1, dp(44)));
        addSpace(form, 10);
        form.addView(password, new LinearLayout.LayoutParams(-1, dp(44)));
        addSpace(form, 12);
        TextView submit = actionButton("Войти", GREEN, Color.WHITE);
        submit.setOnClickListener(v -> {
            loginWithApi(login.getText().toString(), password.getText().toString());
        });
        form.addView(submit, new LinearLayout.LayoutParams(-1, dp(44)));
        content.addView(form);
    }

    private View adminFolderCard(SharedFolder folder) {
        LinearLayout card = card();
        card.setPadding(dp(isTvLandscape() ? 12 : 14), dp(isTvLandscape() ? 10 : 12), dp(isTvLandscape() ? 12 : 14), dp(isTvLandscape() ? 10 : 12));
        card.addView(text(folder.name, isTvLandscape() ? 15 : 17, TEXT, true));
        card.addView(text(folder.path, isTvLandscape() ? 11 : 12, MUTED, false));
        card.addView(text(folder.filesCount + " файлов • " + folder.lastScanAt, 12, MUTED, false));
        addSpace(card, 8);

        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.addView(pill(folder.enabled ? "ON" : "OFF", false));
        TextView delete = actionButton("Удалить путь", Color.rgb(72, 24, 30), Color.rgb(255, 150, 160));
        delete.setOnClickListener(v -> confirmDelete(folder));
        row.addView(delete, new LinearLayout.LayoutParams(0, dp(isTvLandscape() ? 42 : 40), 1));
        card.addView(row);
        return withBottomMargin(card, 10);
    }

    private void confirmDelete(SharedFolder folder) {
        new AlertDialog.Builder(this)
            .setTitle("Удалить путь?")
            .setMessage(folder.path + "\n\nФайлы на диске не удалятся.")
            .setNegativeButton("Отмена", null)
            .setPositiveButton("Удалить", (dialog, which) -> {
                deleteFolder(folder);
            })
            .show();
    }

    private void loginWithApi(String login, String password) {
        isLoading = true;
        loadError = "";
        render();
        new Thread(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("login", login);
                payload.put("password", password);
                JSONObject response = apiClient.postJson("/auth/login", payload);
                apiClient.setAuthToken(response.optString("token", ""));
                runOnUiThread(() -> {
                    isAdmin = true;
                    isLoading = false;
                    loadError = "";
                    refreshData();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    isLoading = false;
                    toastDialog("Ошибка", error.getMessage() == null ? "Не удалось войти." : error.getMessage());
                    render();
                });
            }
        }).start();
    }

    private void addFolder(String path) {
        isLoading = true;
        render();
        new Thread(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("path", path);
                apiClient.postJson("/folders", payload);
                runOnUiThread(() -> {
                    isLoading = false;
                    refreshData();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    isLoading = false;
                    toastDialog("Ошибка", error.getMessage() == null ? "Не удалось добавить папку." : error.getMessage());
                    render();
                });
            }
        }).start();
    }

    private void deleteFolder(SharedFolder folder) {
        isLoading = true;
        render();
        new Thread(() -> {
            try {
                apiClient.delete("/folders/" + Uri.encode(folder.id));
                runOnUiThread(() -> {
                    afterFolderDeleted(folder);
                    isLoading = false;
                    refreshData();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    isLoading = false;
                    toastDialog("Ошибка", error.getMessage() == null ? "Не удалось удалить папку." : error.getMessage());
                    render();
                });
            }
        }).start();
    }

    private void afterFolderDeleted(SharedFolder folder) {
        if (selectedFolderId.equals(folder.id)) {
            selectedFolderId = "all";
        }
        SharedFolder current = repository.getDirectory(currentDirectoryId);
        if (current == null) {
            currentDirectoryId = null;
        }
        invalidateDirectoryEntries();
    }

    private void renderPlayerPage() {
        root.setBackgroundColor(Color.BLACK);

        playerView = new PlayerView(this);
        playerView.setUseController(true);
        playerView.setKeepContentOnPlayerReset(true);
        playerView.setControllerShowTimeoutMs(5000);
        playerView.setFocusable(true);
        playerView.setFocusableInTouchMode(isTvLayout());
        configurePlayerControls(playerView);

        if (isTvLayout()) {
            FrameLayout playerStage = new FrameLayout(this);
            playerStage.addView(playerView, new FrameLayout.LayoutParams(-1, -1));

            LinearLayout playerMetadata = new LinearLayout(this);
            playerMetadata.setOrientation(LinearLayout.VERTICAL);
            playerMetadata.setPadding(dp(18), dp(12), dp(18), dp(12));
            playerMetadata.setBackground(makeRoundDrawable(Color.argb(150, 8, 12, 10), 0, 10));
            playerTitleView = text(selectedVideo.title, 21, Color.WHITE, true);
            playerTitleView.setMaxLines(1);
            playerTitleView.setEllipsize(TextUtils.TruncateAt.END);
            playerSubtitleView = text(playerFileSubtitle(selectedVideo), 12, Color.rgb(205, 215, 210), false);
            playerSubtitleView.setMaxLines(1);
            playerSubtitleView.setEllipsize(TextUtils.TruncateAt.MIDDLE);
            playerMetadata.addView(playerTitleView);
            playerMetadata.addView(playerSubtitleView);
            playerMetadataPanel = playerMetadata;
            FrameLayout.LayoutParams metadataParams = new FrameLayout.LayoutParams(
                Math.min(dp(720), getResources().getDisplayMetrics().widthPixels - dp(80)),
                -2,
                Gravity.TOP | Gravity.LEFT
            );
            metadataParams.setMargins(dp(40), dp(30), dp(40), 0);
            playerStage.addView(playerMetadata, metadataParams);
            playerView.setControllerVisibilityListener(
                (PlayerView.ControllerVisibilityListener) visibility -> {
                    if (playerMetadataPanel != null) {
                        playerMetadataPanel.setVisibility(
                            visibility == View.VISIBLE ? View.VISIBLE : View.GONE
                        );
                    }
                }
            );

            seekFeedbackView = text("", 18, Color.WHITE, true);
            seekFeedbackView.setGravity(Gravity.CENTER);
            seekFeedbackView.setPadding(dp(22), 0, dp(22), 0);
            seekFeedbackView.setBackground(makeLensDrawable(Color.TRANSPARENT, 26, false));
            seekFeedbackView.setVisibility(View.GONE);
            FrameLayout.LayoutParams feedbackParams = new FrameLayout.LayoutParams(-2, dp(52), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
            feedbackParams.bottomMargin = dp(176);
            playerStage.addView(seekFeedbackView, feedbackParams);

            root.addView(playerStage, new LinearLayout.LayoutParams(-1, -1));
        } else {
            seekFeedbackView = null;
            LinearLayout header = new LinearLayout(this);
            header.setGravity(Gravity.CENTER_VERTICAL);
            header.setPadding(dp(12), dp(14), dp(12), dp(10));

            TextView back = pill("Назад", false);
            applyFocus(back, CARD, LIME, 999, LINE);
            back.setOnClickListener(v -> {
                closePlayer();
            });
            header.addView(back);

            LinearLayout titleBox = new LinearLayout(this);
            titleBox.setOrientation(LinearLayout.VERTICAL);
            titleBox.setPadding(dp(12), 0, 0, 0);
            titleBox.addView(text(selectedVideo.title, 19, Color.WHITE, true));
            titleBox.addView(text(selectedVideo.path, 12, Color.rgb(157, 178, 170), false));
            header.addView(titleBox, new LinearLayout.LayoutParams(0, -2, 1));
            root.addView(header);

            root.addView(playerView, new LinearLayout.LayoutParams(-1, 0, 1));

            LinearLayout details = new LinearLayout(this);
            details.setPadding(dp(12), dp(12), dp(12), dp(18));
            details.addView(pill(selectedVideo.codec, true));
            details.addView(pill(selectedVideo.folderName, true));
            root.addView(details);
        }

        OkHttpDataSource.Factory httpFactory = new OkHttpDataSource.Factory(apiClient.client())
            .setUserAgent("LocalVideoVaultMobile/1.0");
        DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(this, httpFactory);
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(12000, 50000, 1500, 3000)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build();
        player = new ExoPlayer.Builder(this)
            .setLoadControl(loadControl)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSourceFactory))
            .build();
        player.setSeekParameters(androidx.media3.exoplayer.SeekParameters.EXACT);
        playerView.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override
            public void onMediaItemTransition(MediaItem mediaItem, int reason) {
                int currentIndex = player == null ? -1 : player.getCurrentMediaItemIndex();
                if (currentIndex < 0 || currentIndex >= playbackQueue.size()) {
                    return;
                }
                playbackIndex = currentIndex;
                selectedVideo = playbackQueue.get(currentIndex);
                returnFocusedVideoId = selectedVideo.id;
                updatePlayerMetadata();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                long position = Math.max(0, player.getCurrentPosition() - 2000);
                player.seekTo(position);
                player.prepare();
                player.play();
            }
        });
        List<MediaItem> mediaItems = new ArrayList<>();
        for (VideoFile video : playbackQueue) {
            mediaItems.add(new MediaItem.Builder()
                .setMediaId(video.id)
                .setUri(Uri.parse(video.streamUrl))
                .build());
        }
        if (mediaItems.isEmpty()) {
            mediaItems.add(new MediaItem.Builder()
                .setMediaId(selectedVideo.id)
                .setUri(Uri.parse(selectedVideo.streamUrl))
                .build());
            playbackQueue.add(selectedVideo);
            playbackIndex = 0;
        }
        player.setMediaItems(mediaItems, Math.max(0, playbackIndex), 0L);
        player.prepare();
        player.play();

        if (isTvLayout()) {
            playerView.showController();
            schedulePlayerControlsHide();
            View playPause = playerView.findViewById(androidx.media3.ui.R.id.exo_play_pause);
            playerView.post(() -> {
                if (playPause == null || !playPause.requestFocus()) {
                    playerView.requestFocus();
                }
            });
        }
    }

    private String playerFileSubtitle(VideoFile video) {
        if (video == null) {
            return "";
        }
        if (video.path != null && !video.path.isEmpty()) {
            return video.path;
        }
        return video.folderName == null ? "" : video.folderName;
    }

    private void updatePlayerMetadata() {
        if (selectedVideo == null) {
            return;
        }
        if (playerTitleView != null) {
            playerTitleView.setText(selectedVideo.title);
        }
        if (playerSubtitleView != null) {
            playerSubtitleView.setText(playerFileSubtitle(selectedVideo));
        }
    }

    private void configurePlayerControls(PlayerView view) {
        view.setClipChildren(false);
        view.setClipToPadding(false);
        view.setShowRewindButton(false);
        view.setShowFastForwardButton(false);
        view.setShowPreviousButton(true);
        view.setShowNextButton(true);

        DefaultTimeBar timeBar = view.findViewById(androidx.media3.ui.R.id.exo_progress);
        if (timeBar != null) {
            timeBar.setFocusable(true);
            timeBar.setFocusableInTouchMode(isTvLayout());
            timeBar.setKeyTimeIncrement(PLAYER_SEEK_STEP_MS);
            timeBar.setPlayedColor(ACCENT);
            timeBar.setScrubberColor(ACCENT);
            timeBar.setBufferedColor(Color.argb(180, 190, 201, 197));
            timeBar.setUnplayedColor(Color.argb(150, 90, 101, 98));
            timeBar.setOnFocusChangeListener((control, hasFocus) -> {
                control.animate().translationY(hasFocus ? -dp(2) : 0).setDuration(120L).start();
                control.setElevation(hasFocus ? dp(6) : 0);
            });
        }

        int[] controlIds = {
            androidx.media3.ui.R.id.exo_prev,
            androidx.media3.ui.R.id.exo_play_pause,
            androidx.media3.ui.R.id.exo_next,
            androidx.media3.ui.R.id.exo_settings,
            androidx.media3.ui.R.id.exo_subtitle,
            androidx.media3.ui.R.id.exo_fullscreen
        };
        for (int controlId : controlIds) {
            View control = view.findViewById(controlId);
            if (control != null) {
                allowFocusOverflow(control, view);
                applyPlayerControlFocus(control);
            }
        }

        View previous = view.findViewById(androidx.media3.ui.R.id.exo_prev);
        View playPause = view.findViewById(androidx.media3.ui.R.id.exo_play_pause);
        View next = view.findViewById(androidx.media3.ui.R.id.exo_next);
        View settings = view.findViewById(androidx.media3.ui.R.id.exo_settings);
        if (previous != null && playPause != null && next != null) {
            previous.setNextFocusRightId(playPause.getId());
            playPause.setNextFocusLeftId(previous.getId());
            playPause.setNextFocusRightId(next.getId());
            next.setNextFocusLeftId(playPause.getId());
            if (timeBar != null) {
                previous.setNextFocusUpId(timeBar.getId());
                playPause.setNextFocusUpId(timeBar.getId());
                next.setNextFocusUpId(timeBar.getId());
                timeBar.setNextFocusDownId(playPause.getId());
            }
            if (settings != null) {
                next.setNextFocusRightId(settings.getId());
                settings.setNextFocusLeftId(next.getId());
            } else {
                next.setNextFocusRightId(next.getId());
            }
            previous.setNextFocusLeftId(previous.getId());
        }
    }

    private void applyPlayerControlFocus(View control) {
        control.setFocusable(true);
        control.setFocusableInTouchMode(isTvLayout());
        control.setStateListAnimator(null);
        updatePlayerControlFocus(control, false);
        control.setOnFocusChangeListener((view, hasFocus) -> updatePlayerControlFocus(view, hasFocus));
    }

    private void updatePlayerControlFocus(View control, boolean hasFocus) {
        control.animate().cancel();
        control.animate()
            .scaleX(1f)
            .scaleY(1f)
            .translationY(0)
            .setDuration(hasFocus ? 130L : 90L)
            .start();
        control.setElevation(hasFocus ? dp(18) : dp(2));
        control.setBackground(makeRoundDrawable(
            hasFocus ? Color.rgb(218, 226, 221) : CARD,
            0,
            999
        ));
        if (control instanceof ImageView) {
            ((ImageView) control).setColorFilter(hasFocus ? DARK : Color.WHITE);
        }
    }

    private void allowFocusOverflow(View control, View stopAt) {
        android.view.ViewParent parent = control.getParent();
        while (parent instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) parent;
            group.setClipChildren(false);
            group.setClipToPadding(false);
            if (group == stopAt) {
                break;
            }
            parent = group.getParent();
        }
    }

    private void showSeekFeedback(int keyCode, long stepMs, long heldForMs) {
        if (seekFeedbackView == null) {
            return;
        }
        int speed = heldForMs >= 3_000L ? 8 : (heldForMs >= 1_800L ? 4 : (heldForMs >= 800L ? 2 : 1));
        String direction = keyCode == KeyEvent.KEYCODE_DPAD_LEFT ? "−" : "+";
        seekFeedbackView.removeCallbacks(hideSeekFeedback);
        seekFeedbackView.animate().cancel();
        seekFeedbackView.setText(direction + (stepMs / 1000L) + " сек  •  " + speed + "x");
        seekFeedbackView.setVisibility(View.VISIBLE);
        seekFeedbackView.setAlpha(0.78f);
        seekFeedbackView.animate().alpha(1f).setDuration(90L).start();
        seekFeedbackView.postDelayed(hideSeekFeedback, 1_800L);
    }

    private void seekPlayerBy(long offsetMs) {
        if (player == null || playerView == null) {
            return;
        }

        long targetPosition = Math.max(0L, player.getCurrentPosition() + offsetMs);
        long duration = player.getDuration();
        if (duration > 0L) {
            targetPosition = Math.min(targetPosition, duration);
        }
        player.seekTo(targetPosition);
        playerView.showController();
    }

    private void renderBottomNav() {
        if (isTvLandscape()) {
            return;
        }

        LinearLayout nav = new LinearLayout(this);
        nav.setGravity(Gravity.CENTER);
        nav.setPadding(dp(isTvLayout() ? 36 : 10), dp(8), dp(isTvLayout() ? 36 : 10), dp(isTvLayout() ? 18 : 10));
        nav.setBackgroundColor(Color.rgb(15, 20, 26));
        nav.addView(navButton("Видео", "videos"), new LinearLayout.LayoutParams(0, dp(54), 1));
        nav.addView(navButton("Файлы", "files"), new LinearLayout.LayoutParams(0, dp(54), 1));
        nav.addView(navButton("Админка", "admin"), new LinearLayout.LayoutParams(0, dp(54), 1));
        root.addView(nav);
    }

    private TextView navButton(String label, String targetPage) {
        boolean selected = targetPage.equals(page);
        TextView button = text(label, isTvLandscape() ? 13 : (isTvLayout() ? 18 : 14), selected ? DARK : MUTED, true);
        button.setGravity(Gravity.CENTER);
        int normalColor = selected ? LIME : CARD;
        button.setBackground(makeRoundDrawable(normalColor, selected ? 0 : LINE, 8));
        applyFocus(button, normalColor, LIME, 8, selected ? 0 : LINE);
        if (selected) {
            rememberTvFallbackFocus(button);
        }
        button.setOnClickListener(v -> {
            page = targetPage;
            selectedVideo = null;
            render();
        });
        return button;
    }

    private TextView actionButton(String label, int background, int color) {
        TextView button = text(label, isTvLandscape() ? 13 : (isTvLayout() ? 17 : 14), DARK, true);
        button.setGravity(Gravity.CENTER);
        button.setMinHeight(dp(isTvLandscape() ? 42 : (isTvLayout() ? 54 : 42)));
        button.setPadding(dp(isTvLandscape() ? 14 : 12), 0, dp(isTvLandscape() ? 14 : 12), 0);
        button.setBackground(makeRoundDrawable(WHITE_CONTROL_IDLE, 0, 12));
        applyFocus(button, WHITE_CONTROL_IDLE, Color.WHITE, 12, 0);
        rememberTvFocus(button);
        return button;
    }

    private void toastDialog(String title, String message) {
        new AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("ОК", null)
            .show();
    }

    private EditText input(String hint, String value) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setText(value);
        input.setSingleLine(true);
        input.setPadding(dp(12), 0, dp(12), 0);
        input.setTextColor(TEXT);
        input.setHintTextColor(MUTED);
        input.setBackground(makeLensDrawable(Color.TRANSPARENT, 12, false));
        input.setTextSize(isTvLandscape() ? 14 : (isTvLayout() ? 18 : 15));
        input.setOnFocusChangeListener((v, hasFocus) -> {
            input.setTranslationY(hasFocus ? -dp(2) : 0);
            input.setElevation(hasFocus ? dp(12) : 0);
            input.setHintTextColor(hasFocus ? TEXT : MUTED);
        });
        return input;
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(makeLensDrawable(Color.TRANSPARENT, 14, false));
        card.setClipToOutline(false);
        card.setElevation(dp(8));
        return card;
    }

    private LinearLayout glassContentPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setClipChildren(false);
        panel.setClipToPadding(false);
        panel.setPadding(dp(12), dp(10), dp(12), dp(12));
        panel.setBackground(makeLensDrawable(Color.TRANSPARENT, 18, false));
        panel.setElevation(dp(8));
        scrollingGlassPanel = panel;
        return panel;
    }

    private LinearLayout mediaCard() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundColor(Color.TRANSPARENT);
        card.setClipChildren(false);
        card.setClipToPadding(false);
        return card;
    }

    private void applyMediaCardFocus(
        LinearLayout card,
        FrameLayout preview,
        TextView title
    ) {
        card.setFocusable(true);
        card.setFocusableInTouchMode(isTvLayout());
        card.setOnFocusChangeListener((view, hasFocus) -> {
            view.animate().cancel();
            view.animate()
                .scaleX(1f)
                .scaleY(1f)
                .translationY(hasFocus ? -dp(4) : 0)
                .setDuration(hasFocus ? 145L : 110L)
                .start();
            view.setElevation(hasFocus ? dp(24) : 0);
            preview.animate().cancel();
            preview.animate()
                .translationY(hasFocus ? -dp(3) : 0)
                .setDuration(hasFocus ? 145L : 110L)
                .start();
            preview.setElevation(hasFocus ? dp(16) : 0);
            title.setTextColor(TEXT);
        });
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setIncludeFontPadding(true);
        if (bold) {
            view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        }
        return view;
    }

    private TextView chip(String label, boolean selected) {
        TextView view = text(label, isTvLandscape() ? 12 : 14, DARK, true);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(isTvLandscape() ? 10 : 14), 0, dp(isTvLandscape() ? 10 : 14), 0);
        int normalColor = selected ? ACTIVE_CONTROL : CATEGORY_IDLE;
        view.setBackground(makeRoundDrawable(normalColor, selected ? 0 : LINE, 999));
        applyFocus(view, normalColor, Color.WHITE, 999, selected ? 0 : LINE);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(isTvLandscape() ? 38 : (isTvLayout() ? 46 : 38)));
        params.setMargins(0, 0, dp(isTvLandscape() ? 6 : 8), 0);
        view.setLayoutParams(params);
        return view;
    }

    private TextView pill(String label, boolean dark) {
        TextView view = text(label, isTvLandscape() ? 11 : 13, dark ? Color.WHITE : TEXT, true);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(isTvLandscape() ? 8 : 10), 0, dp(isTvLandscape() ? 8 : 10), 0);
        view.setBackground(makeRoundDrawable(dark ? Color.argb(220, 8, 8, 8) : SURFACE_SELECTED, dark ? 0 : LINE, 999));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(isTvLandscape() ? 26 : 34));
        params.setMargins(0, 0, dp(isTvLandscape() ? 6 : 8), 0);
        view.setLayoutParams(params);
        return view;
    }

    private View withBottomMargin(View view, int marginDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.setMargins(0, 0, 0, dp(marginDp));
        view.setLayoutParams(params);
        return view;
    }

    private void addSpace(LinearLayout parent, int valueDp) {
        View space = new View(this);
        parent.addView(space, new LinearLayout.LayoutParams(1, dp(valueDp)));
    }

    private void addInlineSpace(LinearLayout parent, int valueDp) {
        View space = new View(this);
        parent.addView(space, new LinearLayout.LayoutParams(dp(valueDp), 1));
    }

    private void enterTvFullscreen() {
        if (!isTvLayout()) {
            return;
        }

        getWindow().setFlags(
            android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN,
            android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
    }

    private void enterPlayerFullscreen() {
        if (!isTvLayout()) {
            return;
        }

        getWindow().setFlags(
            android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN,
            android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private void exitPlayerFullscreen() {
        if (!isTvLayout()) {
            return;
        }

        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        enterTvFullscreen();
    }

    private boolean isTvLayout() {
        float widthDp = screenWidthDp();
        int smallestWidth = getResources().getConfiguration().smallestScreenWidthDp;
        boolean isTelevision = getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_LEANBACK)
            || getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_TELEVISION);
        return isTelevision || widthDp >= 900 || smallestWidth >= 600;
    }

    private boolean isTvLandscape() {
        return isTvLayout()
            && getResources().getConfiguration().orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE;
    }

    private float screenWidthDp() {
        float density = getResources().getDisplayMetrics().density;
        return getResources().getDisplayMetrics().widthPixels / density;
    }

    private int gridColumns() {
        if (isTvLandscape()) {
            return screenWidthDp() >= 1280 ? 6 : 5;
        }
        return isTvLayout() ? 4 : 2;
    }

    private void fillGridTail(LinearLayout row, int itemsCount, int columns) {
        if (row == null) {
            return;
        }
        int remainder = itemsCount % columns;
        if (remainder == 0) {
            return;
        }
        for (int i = remainder; i < columns; i++) {
            row.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1));
        }
    }

    private void rememberTvFocus(View view) {
        if (!isTvLayout() || pendingTvFocus != null || view == null) {
            return;
        }
        pendingTvFocus = view;
    }

    private void rememberTvFallbackFocus(View view) {
        if (!isTvLayout() || pendingTvFallbackFocus != null || view == null) {
            return;
        }
        pendingTvFallbackFocus = view;
    }

    private void focusTvDefaultIfNeeded() {
        if (!isTvLayout()) {
            return;
        }

        View target = pendingTvFocus != null ? pendingTvFocus : pendingTvFallbackFocus;
        if (target == null) {
            return;
        }

        root.post(() -> {
            if (root == null || target.getParent() == null) {
                return;
            }
            View focused = root.findFocus();
            if (focused == null || focused instanceof EditText) {
                if (!target.requestFocus()) {
                    target.requestFocusFromTouch();
                }
            }
        });
    }

    private void applyFocus(View view, int normalColor, int focusedColor) {
        applyFocus(view, normalColor, focusedColor, 10, LINE);
    }

    private void applyFocus(View view, int normalColor, int focusedColor, int radiusDp, int normalStrokeColor) {
        view.setFocusable(true);
        view.setFocusableInTouchMode(isTvLayout());
        final int normalTextColor = view instanceof TextView ? ((TextView) view).getCurrentTextColor() : 0;
        view.setOnFocusChangeListener((v, hasFocus) -> {
            boolean textControl = v instanceof TextView;
            v.animate().cancel();
            v.animate()
                .scaleX(1f)
                .scaleY(1f)
                .translationY(0)
                .setDuration(hasFocus ? 130L : 90L)
                .start();
            v.setElevation(hasFocus ? dp(isTvLandscape() ? 14 : 16) : 0);
            int activeBackground = v instanceof TextView ? focusedColor : SURFACE_SELECTED;
            v.setBackground(makeRoundDrawable(hasFocus ? activeBackground : normalColor, 0, radiusDp));
            if (textControl) {
                ((TextView) v).setTextColor(hasFocus ? DARK : normalTextColor);
            }
        });
    }

    private android.graphics.drawable.GradientDrawable makeRoundDrawable(int color, int strokeColor, int radiusDp) {
        return makeRoundDrawable(color, strokeColor, radiusDp, 1);
    }

    private android.graphics.drawable.GradientDrawable makeRoundDrawable(int color, int strokeColor, int radiusDp, int strokeDp) {
        android.graphics.drawable.GradientDrawable drawable = new android.graphics.drawable.GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeColor != 0) {
            drawable.setStroke(dp(strokeDp), strokeColor);
        }
        return drawable;
    }

    private GradientDrawable makeGradientDrawable(GradientDrawable.Orientation orientation, int[] colors) {
        GradientDrawable drawable = new GradientDrawable(orientation, colors);
        drawable.setGradientType(GradientDrawable.LINEAR_GRADIENT);
        return drawable;
    }

    private Drawable makeLensDrawable(int tintColor, int radiusDp, boolean focused) {
        return new RefractiveGlassDrawable(tintColor, dp(radiusDp), focused);
    }

    private final class RefractiveGlassDrawable extends Drawable {
        private static final float GLASS_REFRACTIVE_INDEX = 1.5f;
        private final float radiusPx;
        private final boolean focused;
        private final Paint refractionPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        private final Paint backdropPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        private final Matrix backdropMatrix = new Matrix();
        private final RectF drawBounds = new RectF();
        private final Path clipPath = new Path();
        private final int[] drawLocation = new int[]{0, 0};
        private BitmapShader backdropShader;
        private Bitmap edgeRefractionBitmap;
        private int cachedWidth = -1;
        private int cachedHeight = -1;
        private int cachedScreenX = Integer.MIN_VALUE;
        private int cachedScreenY = Integer.MIN_VALUE;
        private int alpha = 255;

        RefractiveGlassDrawable(int tintColor, float radiusPx, boolean focused) {
            this.radiusPx = radiusPx;
            this.focused = focused;
        }

        @Override
        public void draw(Canvas canvas) {
            drawBounds.set(getBounds());
            if (drawBounds.isEmpty()) {
                return;
            }

            drawLocation[0] = 0;
            drawLocation[1] = 0;
            if (getCallback() instanceof View) {
                ((View) getCallback()).getLocationOnScreen(drawLocation);
            }

            int save = canvas.save();
            clipPath.reset();
            clipPath.addRoundRect(drawBounds, radiusPx, radiusPx, Path.Direction.CW);
            canvas.clipPath(clipPath);

            drawFixedBlurredBackdrop(canvas, drawBounds, drawLocation);

            ensureOpticalLayers(
                Math.round(drawBounds.width()),
                Math.round(drawBounds.height()),
                drawLocation
            );
            if (edgeRefractionBitmap != null) {
                refractionPaint.setShader(null);
                refractionPaint.setAlpha(alpha);
                canvas.drawBitmap(edgeRefractionBitmap, null, drawBounds, refractionPaint);
            }
            canvas.restoreToCount(save);
        }

        private void drawFixedBlurredBackdrop(Canvas canvas, RectF bounds, int[] location) {
            if (glassBackdropBitmap == null) {
                return;
            }
            float screenWidth = getResources().getDisplayMetrics().widthPixels;
            float screenHeight = getResources().getDisplayMetrics().heightPixels;
            float scale = Math.max(
                screenWidth / glassBackdropBitmap.getWidth(),
                screenHeight / glassBackdropBitmap.getHeight()
            );
            float left = (screenWidth - glassBackdropBitmap.getWidth() * scale) / 2f;
            float top = (screenHeight - glassBackdropBitmap.getHeight() * scale) / 2f;
            if (backdropShader == null) {
                backdropShader = new BitmapShader(
                    glassBackdropBitmap,
                    Shader.TileMode.CLAMP,
                    Shader.TileMode.CLAMP
                );
            }
            backdropMatrix.reset();
            backdropMatrix.setScale(scale, scale);
            backdropMatrix.postTranslate(left - location[0], top - location[1]);
            backdropShader.setLocalMatrix(backdropMatrix);
            backdropPaint.setShader(backdropShader);
            backdropPaint.setAlpha(alpha);
            canvas.drawRoundRect(bounds, radiusPx, radiusPx, backdropPaint);
            backdropPaint.setShader(null);
        }

        private void ensureOpticalLayers(int width, int height, int[] location) {
            if (glassBackdropBitmap == null || glassOpticalPixels == null || width <= 0 || height <= 0) {
                return;
            }
            if (edgeRefractionBitmap != null
                && cachedWidth == width
                && cachedHeight == height) {
                return;
            }

            cachedWidth = width;
            cachedHeight = height;
            cachedScreenX = location[0];
            cachedScreenY = location[1];

            long area = (long) width * height;
            if (area > 1_500_000L) {
                edgeRefractionBitmap = null;
                return;
            }

            float opticalScale = area > 1_000_000L ? 0.34f : (area > 300_000L ? 0.5f : 1f);
            int opticalWidth = Math.max(1, Math.round(width * opticalScale));
            int opticalHeight = Math.max(1, Math.round(height * opticalScale));
            float coordinateScale = 1f / opticalScale;
            edgeRefractionBitmap = Bitmap.createBitmap(
                opticalWidth,
                opticalHeight,
                Bitmap.Config.ARGB_8888
            );

            int sourceWidth = glassBackdropBitmap.getWidth();
            int sourceHeight = glassBackdropBitmap.getHeight();
            int[] refracted = new int[opticalWidth * opticalHeight];

            float screenWidth = getResources().getDisplayMetrics().widthPixels;
            float screenHeight = getResources().getDisplayMetrics().heightPixels;
            float backgroundScale = Math.max(screenWidth / sourceWidth, screenHeight / sourceHeight);
            float backgroundLeft = (screenWidth - sourceWidth * backgroundScale) / 2f;
            float backgroundTop = (screenHeight - sourceHeight * backgroundScale) / 2f;
            float radius = Math.min(
                radiusPx * opticalScale,
                Math.min(opticalWidth, opticalHeight) / 2f
            );
            float bezel = Math.max(
                dp(9) * opticalScale,
                Math.min(dp(26) * opticalScale, radius * 0.78f)
            );
            float maxDisplacement = Math.min(
                    dp(focused ? 18 : 15),
                    Math.min(width, height) * (focused ? 0.23f : 0.20f)
            );
            float magnification = 1f;
            int profileSteps = Math.max(2, (int) Math.ceil(bezel) + 1);
            float[] displacementProfile = new float[profileSteps];
            for (int i = 0; i < profileSteps; i++) {
                float distanceFromEdge = i;
                float profileX = Math.max(0.015f, Math.min(1f, distanceFromEdge / bezel));
                float oneMinusX = 1f - profileX;
                float base = Math.max(0.000001f, 1f - (float) Math.pow(oneMinusX, 4));
                float slope = (float) (Math.pow(oneMinusX, 3) * Math.pow(base, -0.75));
                float incidence = (float) Math.atan(slope);
                float refractedAngle = (float) Math.asin(
                    Math.sin(incidence) / GLASS_REFRACTIVE_INDEX
                );
                float normalizedBend = Math.min(
                    1f,
                    (float) Math.tan(incidence - refractedAngle) / 1.12f
                );
                displacementProfile[i] = maxDisplacement * normalizedBend;
            }
            float halfWidth = opticalWidth / 2f;
            float halfHeight = opticalHeight / 2f;
            float coreHalfWidth = Math.max(0f, halfWidth - radius);
            float coreHalfHeight = Math.max(0f, halfHeight - radius);

            for (int y = 0; y < opticalHeight; y++) {
                for (int x = 0; x < opticalWidth; x++) {
                    float localX = x + 0.5f - halfWidth;
                    float localY = y + 0.5f - halfHeight;
                    float qx = Math.abs(localX) - coreHalfWidth;
                    float qy = Math.abs(localY) - coreHalfHeight;
                    float positiveX = Math.max(qx, 0f);
                    float positiveY = Math.max(qy, 0f);
                    float signedDistance = (float) Math.hypot(positiveX, positiveY)
                        + Math.min(Math.max(qx, qy), 0f) - radius;
                    if (signedDistance > 0f) {
                        continue;
                    }

                    float outwardX;
                    float outwardY;
                    if (positiveX > 0f || positiveY > 0f) {
                        float length = Math.max(0.0001f, (float) Math.hypot(positiveX, positiveY));
                        outwardX = positiveX / length * Math.signum(localX);
                        outwardY = positiveY / length * Math.signum(localY);
                    } else if (qx > qy) {
                        outwardX = Math.signum(localX);
                        outwardY = 0f;
                    } else {
                        outwardX = 0f;
                        outwardY = Math.signum(localY);
                    }

                    float distanceFromEdge = -signedDistance;
                    if (distanceFromEdge >= bezel) {
                        continue;
                    }
                    float displacement = 0f;
                    float profilePosition = Math.max(
                        0f,
                        Math.min(profileSteps - 1f, distanceFromEdge)
                    );
                    int profileStart = (int) profilePosition;
                    int profileEnd = Math.min(profileSteps - 1, profileStart + 1);
                    float profileMix = profilePosition - profileStart;
                    displacement = displacementProfile[profileStart]
                        + (displacementProfile[profileEnd] - displacementProfile[profileStart])
                        * profileMix;

                    float sampleScreenX = location[0] + width / 2f
                        + localX * coordinateScale / magnification
                        - outwardX * displacement;
                    float sampleScreenY = location[1] + height / 2f
                        + localY * coordinateScale / magnification
                        - outwardY * displacement;
                    float sourceX = (sampleScreenX - backgroundLeft) / backgroundScale;
                    float sourceY = (sampleScreenY - backgroundTop) / backgroundScale;
                    float blurRadius = 0.85f + distanceFromEdge / Math.max(1f, bezel) * 1.15f;
                    int refractedColor = blurredSample(
                        glassOpticalPixels, sourceWidth, sourceHeight, sourceX, sourceY, blurRadius
                    );
                    refracted[y * opticalWidth + x] = refractedColor;
                }
            }

            edgeRefractionBitmap.setPixels(
                refracted,
                0,
                opticalWidth,
                0,
                0,
                opticalWidth,
                opticalHeight
            );
        }

        private void invalidateOpticalCache() {
            cachedWidth = -1;
            cachedHeight = -1;
            invalidateSelf();
        }

        private int bilinearSample(int[] pixels, int width, int height, float x, float y) {
            float clampedX = Math.max(0f, Math.min(width - 1.001f, x));
            float clampedY = Math.max(0f, Math.min(height - 1.001f, y));
            int x0 = (int) clampedX;
            int y0 = (int) clampedY;
            int x1 = Math.min(width - 1, x0 + 1);
            int y1 = Math.min(height - 1, y0 + 1);
            float fx = clampedX - x0;
            float fy = clampedY - y0;
            int c00 = pixels[y0 * width + x0];
            int c10 = pixels[y0 * width + x1];
            int c01 = pixels[y1 * width + x0];
            int c11 = pixels[y1 * width + x1];
            int red = bilerp(Color.red(c00), Color.red(c10), Color.red(c01), Color.red(c11), fx, fy);
            int green = bilerp(Color.green(c00), Color.green(c10), Color.green(c01), Color.green(c11), fx, fy);
            int blue = bilerp(Color.blue(c00), Color.blue(c10), Color.blue(c01), Color.blue(c11), fx, fy);
            return Color.rgb(red, green, blue);
        }

        private int blurredSample(
            int[] pixels,
            int width,
            int height,
            float x,
            float y,
            float blurRadius
        ) {
            int center = bilinearSample(pixels, width, height, x, y);
            int left = bilinearSample(pixels, width, height, x - blurRadius, y);
            int right = bilinearSample(pixels, width, height, x + blurRadius, y);
            int top = bilinearSample(pixels, width, height, x, y - blurRadius);
            int bottom = bilinearSample(pixels, width, height, x, y + blurRadius);
            int red = (Color.red(center) * 4 + Color.red(left) + Color.red(right)
                + Color.red(top) + Color.red(bottom)) / 8;
            int green = (Color.green(center) * 4 + Color.green(left) + Color.green(right)
                + Color.green(top) + Color.green(bottom)) / 8;
            int blue = (Color.blue(center) * 4 + Color.blue(left) + Color.blue(right)
                + Color.blue(top) + Color.blue(bottom)) / 8;
            return Color.rgb(red, green, blue);
        }

        private int bilerp(int c00, int c10, int c01, int c11, float fx, float fy) {
            float top = c00 + (c10 - c00) * fx;
            float bottom = c01 + (c11 - c01) * fx;
            return Math.round(top + (bottom - top) * fy);
        }

        @Override
        public void setAlpha(int alpha) {
            this.alpha = alpha;
            invalidateSelf();
        }

        @Override
        public void setColorFilter(ColorFilter colorFilter) {
            invalidateSelf();
        }

        @Override
        public int getOpacity() {
            return PixelFormat.TRANSLUCENT;
        }

        @Override
        public void getOutline(Outline outline) {
            outline.setRoundRect(getBounds(), radiusPx);
            outline.setAlpha(focused ? 0.92f : 0.72f);
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static final class SixteenNineFrameLayout extends FrameLayout {
        SixteenNineFrameLayout(android.content.Context context) {
            super(context);
        }

        @Override
        protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
            int width = View.MeasureSpec.getSize(widthMeasureSpec);
            if (width <= 0) {
                super.onMeasure(widthMeasureSpec, heightMeasureSpec);
                return;
            }
            int height = Math.round(width * 9f / 16f);
            super.onMeasure(
                widthMeasureSpec,
                View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
            );
        }
    }

    private void releasePlayer() {
        if (seekFeedbackView != null) {
            seekFeedbackView.removeCallbacks(hideSeekFeedback);
        }
        if (player != null) {
            player.release();
            player = null;
        }
        if (playerView != null) {
            playerView.removeCallbacks(hidePlayerControls);
            playerView.setControllerVisibilityListener(
                (PlayerView.ControllerVisibilityListener) null
            );
        }
        playerView = null;
        playerMetadataPanel = null;
        playerTitleView = null;
        playerSubtitleView = null;
        seekFeedbackView = null;
        lastPlayerSeekAtMs = 0L;
        playerSeekStartedAtMs = 0L;
    }
}

package com.localvideovault.mobile;

import android.app.DownloadManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.SystemClock;
import android.text.InputType;
import android.text.TextUtils;
import android.util.LruCache;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.DefaultTimeBar;
import androidx.media3.ui.PlayerView;

import com.google.android.material.card.MaterialCardView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.localvideovault.mobile.data.ApiClient;
import com.localvideovault.mobile.data.VaultHlsPlaylistParser;
import com.localvideovault.mobile.data.VaultRepository;
import com.localvideovault.mobile.data.VaultWebSocketClient;
import com.localvideovault.mobile.model.FileEntry;
import com.localvideovault.mobile.model.SharedFolder;
import com.localvideovault.mobile.model.VideoFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Collator;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.Request;
import okhttp3.Response;

@UnstableApi
public class MainActivity extends AppCompatActivity {
    private static final long PLAYER_SEEK_STEP_MS = 5_000L;
    private static final int TV_NAV_COLLAPSED_WIDTH_DP = 76;
    private static final int TV_NAV_EXPANDED_WIDTH_DP = 236;

    // Lively YouTube / VK Video / Rutube Dark TV Palette with Frontend Amber Accent (Zero Borders)
    private static final int BG = Color.rgb(15, 16, 20);               // #0F1014 deep rich canvas
    private static final int SURFACE = Color.rgb(23, 25, 32);          // #171920 floating nav pill & surfaces
    private static final int CARD = Color.rgb(28, 30, 38);             // #1C1E26 soft pill / card fill
    private static final int CARD_ELEVATED = Color.rgb(37, 40, 50);    // #252832 elevated / hovered pill
    private static final int SURFACE_SELECTED = Color.rgb(44, 48, 60); // #2C303C active surface
    private static final int POSTER_BG = Color.rgb(27, 30, 38);        // #1B1E26 thumbnail placeholder
    private static final int FOLDER_BG = Color.rgb(42, 35, 25);        // #2A2319 warm playlist folder tile
    private static final int FOLDER_BORDER = Color.TRANSPARENT;
    private static final int LINE = Color.TRANSPARENT;                 // No 1px borders!
    private static final int CONTROL_LINE = Color.TRANSPARENT;         // No 1px borders!
    private static final int DIVIDER = Color.TRANSPARENT;
    private static final int TEXT = Color.rgb(243, 244, 246);          // #F3F4F6 crisp primary text
    private static final int MUTED = Color.rgb(148, 155, 166);         // #949BA6 soft secondary text
    private static final int ACCENT = Color.rgb(252, 163, 17);         // #FCA311 signature amber-gold
    private static final int ACCENT_LIGHT = Color.rgb(255, 208, 138);  // #FFD08A bright warm highlight
    private static final int ACCENT_SOFT = Color.rgb(48, 40, 27);      // #30281B soft warm active pill
    private static final int ACCENT_STROKE = Color.TRANSPARENT;
    private static final int GREEN = Color.rgb(252, 163, 17);
    private static final int DARK = Color.rgb(15, 16, 20);             // #0F1014 dark text on bright pills
    private static final int LIME = Color.rgb(252, 163, 17);
    private static final int WHITE_CONTROL = Color.rgb(252, 163, 17);
    private static final int WHITE_CONTROL_IDLE = Color.rgb(28, 30, 38);
    private static final int CATEGORY_IDLE = Color.rgb(28, 30, 38);
    private static final int ACTIVE_CONTROL = Color.rgb(48, 40, 27);
    private static final int ACTIVE_ICON = Color.rgb(252, 163, 17);

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
    private String sortField = "name";
    private int fileTypeFilter = 0;
    private static final String[] FILE_TYPES = {"Видео", "Файлы", "Изображения", "Все типы"};
    private boolean sortAscending = true;
    private final Collator nameCollator = Collator.getInstance(new Locale("ru"));
    private boolean isAdmin = false;
    private String accountLogin = "";
    private String loginReturnPage = "videos";
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
    private LinearLayout tvNavRail = null;
    private LinearLayout controlsPanel = null;
    private boolean tvNavExpanded = false;
    private TextView seekFeedbackView = null;
    private View playerMetadataPanel = null;
    private TextView playerTitleView = null;
    private TextView playerSubtitleView = null;

    // YouTube TV custom player overlay state & views
    private static final float[] PLAYBACK_SPEEDS = {0.5f, 0.75f, 1.0f, 1.25f, 1.5f, 1.75f, 2.0f};
    private float playerSpeed = 1.0f;
    private int playerResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT;
    private int playerRepeatMode = Player.REPEAT_MODE_OFF;
    private boolean playerAutoplay = true;
    private boolean playerStatsVisible = false;
    private long sleepTimerEndAtMs = 0L; // 0 = off, -1 = stop after current video, >0 = elapsedRealtime target
    private boolean tvHudVisible = false;
    private boolean tvQueueOpen = false;
    private boolean tvUpNextVisible = false;
    private int tvUpNextCountdownSec = 0;
    private int tvUpNextTargetIndex = -1;
    private long lastProgressSaveAtMs = 0L;

    private FrameLayout tvPlayerHud = null;
    private ProgressBar tvBufferingSpinner = null;
    private TvSeekBar tvSeekBar = null;
    private TextView tvCurrentTimeView = null;
    private TextView tvTotalTimeView = null;
    private TextView tvClockView = null;
    private TextView tvFinishTimeView = null;
    private LinearLayout tvStatusBadgesRow = null;
    private View tvBackButton = null;
    private FrameLayout tvPlayPauseButton = null;
    private ImageView tvPlayPauseIcon = null;
    private View tvPrevButton = null;
    private View tvRewindButton = null;
    private View tvForwardButton = null;
    private View tvNextButton = null;
    private View tvQueueButton = null;
    private TextView tvSpeedButton = null;
    private View tvTracksButton = null;
    private View tvAspectButton = null;
    private FrameLayout tvRepeatButton = null;
    private ImageView tvRepeatIcon = null;
    private View tvAutoplayButton = null;
    private View tvMoreButton = null;
    private LinearLayout tvQueuePanel = null;
    private HorizontalScrollView tvQueueScroll = null;
    private LinearLayout tvQueueRow = null;
    private TextView tvQueueHeading = null;
    private LinearLayout tvSeekLeftOverlay = null;
    private TextView tvSeekLeftLabel = null;
    private LinearLayout tvSeekRightOverlay = null;
    private TextView tvSeekRightLabel = null;
    private LinearLayout tvCenterActionOverlay = null;
    private ImageView tvCenterActionIcon = null;
    private TextView tvCenterActionLabel = null;
    private LinearLayout tvMiniProgressContainer = null;
    private TvSeekBar tvMiniSeekBar = null;
    private TextView tvMiniTimeLabel = null;
    private LinearLayout tvStatsOverlay = null;
    private TextView tvStatsBody = null;
    private LinearLayout tvUpNextOverlay = null;
    private TextView tvUpNextCountdownLabel = null;
    private TextView tvUpNextTitleView = null;
    private TextView tvUpNextDurationView = null;
    private ImageView tvUpNextPosterView = null;
    private TextView tvUpNextPlayNowBtn = null;
    private TextView tvUpNextCancelBtn = null;

    private long lastPlayerSeekAtMs = 0L;
    private long playerSeekStartedAtMs = 0L;
    private long quickSeekAccumulatedMs = 0L;
    private int quickSeekDirection = 0; // -1 left, +1 right
    private long lastQuickSeekEventMs = 0L;
    private long scrubAccumulatedMs = 0L;

    private final Runnable hideSeekFeedback = () -> {
        quickSeekAccumulatedMs = 0L;
        quickSeekDirection = 0;
        fadeOutOverlay(tvSeekLeftOverlay);
        fadeOutOverlay(tvSeekRightOverlay);
        fadeOutOverlay(tvMiniProgressContainer);
        if (seekFeedbackView != null) {
            fadeOutOverlay(seekFeedbackView);
        }
    };
    private final Runnable clearScrubPreview = () -> {
        scrubAccumulatedMs = 0L;
        if (tvSeekBar != null) {
            tvSeekBar.setScrubPreview(false, player == null ? 0L : player.getCurrentPosition(), "");
        }
    };
    private final Runnable hideCenterAction = () -> fadeOutOverlay(tvCenterActionOverlay);
    private final Runnable hidePlayerControls = () -> {
        if ("player".equals(page) && isTvLayout()) {
            if (player != null && player.isPlaying() && !tvQueueOpen && !tvUpNextVisible) {
                setTvHudVisible(false, null);
            }
        } else if (playerView != null && "player".equals(page)) {
            playerView.hideController();
        }
    };
    private final Runnable playerTickRunnable = new Runnable() {
        @Override
        public void run() {
            if (!"player".equals(page) || player == null || playerView == null) {
                return;
            }
            updateTvPlayerProgressUi();
            playerView.postDelayed(this, 350L);
        }
    };
    private final Runnable upNextCountdownRunnable = new Runnable() {
        @Override
        public void run() {
            if (!tvUpNextVisible || !"player".equals(page) || player == null) {
                return;
            }
            if (tvUpNextCountdownSec <= 0) {
                playUpNextTarget();
                return;
            }
            if (tvUpNextCountdownLabel != null) {
                tvUpNextCountdownLabel.setText("ДАЛЕЕ ЧЕРЕЗ " + tvUpNextCountdownSec + " СЕК");
            }
            tvUpNextCountdownSec--;
            if (playerView != null) {
                playerView.postDelayed(this, 1_000L);
            }
        }
    };

    // WebSocket & YouTube-style Cast / Remote Playback state
    private VaultWebSocketClient wsClient = null;
    private boolean wsConnected = false;
    private String vaultDeviceId = "";
    private String vaultDeviceName = "";
    private final List<VaultWebSocketClient.TvDevice> onlineTvDevices = new ArrayList<>();
    private String selectedCastTvId = "";
    private String castSenderName = "";
    private String lastCastSenderName = "";
    private boolean isRemoteQueueActive = false;
    private String locallyStartedVideoId = "";
    private String lastReportedPlayNowKey = "";
    private DefaultDataSource.Factory activeMediaDataSourceFactory = null;
    private DefaultMediaSourceFactory activeDirectMediaSourceFactory = null;
    private FrameLayout appRootOverlayHost = null;
    private LinearLayout castToastBanner = null;
    private ImageView castToastIcon = null;
    private TextView castToastTitle = null;
    private TextView castToastSubtitle = null;
    private LinearLayout headerCastPill = null;
    private View headerCastDot = null;
    private ImageView headerCastIcon = null;
    private TextView headerCastLabel = null;
    private String pendingCastToastTitle = "";
    private String pendingCastToastSubtitle = "";
    private final Runnable hideCastToastBanner = () -> {
        if (castToastBanner == null) return;
        castToastBanner.animate().cancel();
        castToastBanner.animate()
            .alpha(0f)
            .translationY(-dp(18))
            .setDuration(220L)
            .withEndAction(() -> {
                if (castToastBanner != null && castToastBanner.getAlpha() <= 0.05f) {
                    castToastBanner.setVisibility(View.GONE);
                }
            })
            .start();
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        apiClient = new ApiClient(this);
        sortField = getPreferences(MODE_PRIVATE).getString("sortField", "name");
        sortAscending = getPreferences(MODE_PRIVATE).getBoolean("sortAscending", true);
        viewMode = getPreferences(MODE_PRIVATE).getString("viewMode", "grid");
        playerAutoplay = getPreferences(MODE_PRIVATE).getBoolean("playerAutoplay", true);
        playerResizeMode = getPreferences(MODE_PRIVATE).getInt("playerResizeMode", AspectRatioFrameLayout.RESIZE_MODE_FIT);
        selectedCastTvId = getPreferences(MODE_PRIVATE).getString("selectedCastTvId", "");
        initDeviceIdentity();
        nameCollator.setStrength(Collator.PRIMARY);
        enterTvFullscreen();
        startVaultWebSocket();
        refreshData();
    }

    @Override
    protected void onStop() {
        saveCurrentVideoProgress(false);
        if (player != null) player.pause();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        if (wsClient != null) {
            wsClient.stop();
            wsClient = null;
        }
        releasePlayer();
        posterExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if ("player".equals(page)) {
            if (isTvLayout()) {
                if (tvUpNextVisible) {
                    dismissUpNextOverlay(true);
                    return;
                }
                if (tvQueueOpen) {
                    setTvQueueOpen(false, tvPlayPauseButton);
                    return;
                }
                if (playerStatsVisible) {
                    playerStatsVisible = false;
                    updateStatsOverlayVisibility();
                    return;
                }
                if (tvHudVisible) {
                    setTvHudVisible(false, null);
                    return;
                }
            }
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
        if ("login".equals(page)) {
            page = loginReturnPage;
            render();
            return;
        }
        if ("admin".equals(page) || "settings".equals(page) || "account".equals(page)) {
            page = "videos";
            render();
            return;
        }
        super.onBackPressed();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if ("player".equals(page) && isTvLayout() && player != null && playerView != null) {
            int keyCode = event.getKeyCode();
            int action = event.getAction();

            // Hardware TV remote media keys (always responsive, HUD hidden or visible)
            if (handleTvMediaHardwareKey(keyCode, action, event.getRepeatCount())) {
                return true;
            }

            // While Up-Next countdown card is displayed, let D-Pad navigate its buttons directly
            if (tvUpNextVisible) {
                if (keyCode == KeyEvent.KEYCODE_BACK && action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                    dismissUpNextOverlay(true);
                    return true;
                }
                return super.dispatchKeyEvent(event);
            }

            // When HUD is hidden: full YouTube TV direct remote ergonomics
            if (!tvHudVisible) {
                if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                    handleTvQuickSeekKey(keyCode, action);
                    return true;
                }
                if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                    if (isPlayerToggleKey(keyCode)) {
                        togglePlayPauseFromRemote(true);
                        return true;
                    }
                    if (keyCode == KeyEvent.KEYCODE_DPAD_UP) {
                        setTvHudVisible(true, tvSeekBar != null ? tvSeekBar : tvPlayPauseButton);
                        return true;
                    }
                    if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
                        if (playbackQueue.size() > 1) {
                            setTvHudVisible(true, null);
                            setTvQueueOpen(true, null);
                        } else {
                            setTvHudVisible(true, tvPlayPauseButton);
                        }
                        return true;
                    }
                } else if (action == KeyEvent.ACTION_UP
                    && (isPlayerToggleKey(keyCode) || keyCode == KeyEvent.KEYCODE_DPAD_UP || keyCode == KeyEvent.KEYCODE_DPAD_DOWN)) {
                    return true;
                }
                return super.dispatchKeyEvent(event);
            }

            // When HUD is visible: keep auto-hide fresh on every user interaction
            if (action == KeyEvent.ACTION_DOWN) {
                schedulePlayerControlsHide();
            }

            View focused = getCurrentFocus();

            // Progressive scrubbing directly on TvSeekBar
            if ((keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT)
                && focused == tvSeekBar) {
                handleTvTimelineScrubKey(keyCode, action);
                return true;
            }
            if (isPlayerToggleKey(keyCode) && focused == tvSeekBar) {
                if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                    togglePlayPauseFromRemote(false);
                }
                return true;
            }

            // Pressing DPAD_DOWN from main controls row opens Up-Next queue shelf
            if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN
                && action == KeyEvent.ACTION_DOWN
                && event.getRepeatCount() == 0
                && !tvQueueOpen
                && playbackQueue.size() > 1
                && isMainPlayerControl(focused)) {
                setTvQueueOpen(true, null);
                return true;
            }

            // Pressing DPAD_UP from inside Up-Next queue shelf collapses it back to controls row
            if (keyCode == KeyEvent.KEYCODE_DPAD_UP
                && action == KeyEvent.ACTION_DOWN
                && event.getRepeatCount() == 0
                && tvQueueOpen
                && isDescendantOf(focused, tvQueuePanel)) {
                setTvQueueOpen(false, tvPlayPauseButton);
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private boolean handleTvMediaHardwareKey(int keyCode, int action, int repeatCount) {
        if (keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD || keyCode == KeyEvent.KEYCODE_MEDIA_REWIND) {
            int mapped = keyCode == KeyEvent.KEYCODE_MEDIA_REWIND ? KeyEvent.KEYCODE_DPAD_LEFT : KeyEvent.KEYCODE_DPAD_RIGHT;
            handleTvQuickSeekKey(mapped, action);
            return true;
        }
        if (action == KeyEvent.ACTION_UP
            && (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY
            || keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE
            || keyCode == KeyEvent.KEYCODE_MEDIA_NEXT
            || keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS
            || keyCode == KeyEvent.KEYCODE_MEDIA_STOP)) {
            return true;
        }
        if (action != KeyEvent.ACTION_DOWN || repeatCount > 0) {
            return false;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
            togglePlayPauseFromRemote(!tvHudVisible);
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY) {
            if (!player.isPlaying()) {
                player.play();
                showCenterAction(R.drawable.ic_play_tv, "Воспроизведение");
            }
            if (tvHudVisible) schedulePlayerControlsHide();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE) {
            if (player.isPlaying()) {
                player.pause();
                showCenterAction(R.drawable.ic_pause_tv, "Пауза");
            }
            setTvHudVisible(true, tvPlayPauseButton);
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_NEXT) {
            playNextInQueue();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS) {
            playPreviousOrRestart();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_STOP) {
            closePlayer();
            return true;
        }
        return false;
    }

    private void handleTvQuickSeekKey(int keyCode, int action) {
        if (action == KeyEvent.ACTION_DOWN) {
            long now = SystemClock.elapsedRealtime();
            int direction = keyCode == KeyEvent.KEYCODE_DPAD_LEFT ? -1 : 1;
            if (playerSeekStartedAtMs == 0L || quickSeekDirection != direction) {
                playerSeekStartedAtMs = now;
            }
            long heldForMs = now - playerSeekStartedAtMs;
            long repeatIntervalMs = playerSeekRepeatInterval(heldForMs);
            if (lastPlayerSeekAtMs == 0L || now - lastPlayerSeekAtMs >= repeatIntervalMs) {
                long stepMs = heldForMs < 650L ? 10_000L : playerSeekStep(heldForMs);
                if (now - lastQuickSeekEventMs > 1_150L || quickSeekDirection != direction) {
                    quickSeekAccumulatedMs = 0L;
                }
                quickSeekDirection = direction;
                quickSeekAccumulatedMs += stepMs;
                lastQuickSeekEventMs = now;
                lastPlayerSeekAtMs = now;

                seekPlayerSilentBy(direction * stepMs);
                showSideSeekIndicator(direction, quickSeekAccumulatedMs);
                showMiniProgressOverlay();
            }
        } else if (action == KeyEvent.ACTION_UP) {
            lastPlayerSeekAtMs = 0L;
            playerSeekStartedAtMs = 0L;
        }
    }

    private void handleTvTimelineScrubKey(int keyCode, int action) {
        if (action == KeyEvent.ACTION_DOWN) {
            long now = SystemClock.elapsedRealtime();
            int direction = keyCode == KeyEvent.KEYCODE_DPAD_LEFT ? -1 : 1;
            if (playerSeekStartedAtMs == 0L) {
                playerSeekStartedAtMs = now;
                scrubAccumulatedMs = 0L;
            }
            long heldForMs = now - playerSeekStartedAtMs;
            long repeatIntervalMs = playerSeekRepeatInterval(heldForMs);
            if (lastPlayerSeekAtMs == 0L || now - lastPlayerSeekAtMs >= repeatIntervalMs) {
                long stepMs = playerSeekStep(heldForMs);
                long delta = direction * stepMs;
                scrubAccumulatedMs += delta;
                lastPlayerSeekAtMs = now;

                long targetPos = seekPlayerSilentBy(delta);
                if (tvSeekBar != null) {
                    String sign = scrubAccumulatedMs >= 0 ? "+" : "−";
                    String deltaLabel = sign + TvSeekBar.formatTime(Math.abs(scrubAccumulatedMs));
                    tvSeekBar.setPosition(targetPos);
                    tvSeekBar.setScrubPreview(true, targetPos, deltaLabel);
                    tvSeekBar.removeCallbacks(clearScrubPreview);
                    tvSeekBar.postDelayed(clearScrubPreview, 1_100L);
                }
                updateTvPlayerProgressUi();
            }
        } else if (action == KeyEvent.ACTION_UP) {
            lastPlayerSeekAtMs = 0L;
            playerSeekStartedAtMs = 0L;
        }
    }

    private void schedulePlayerControlsHide() {
        if (playerView == null || !isTvLayout()) {
            return;
        }
        playerView.removeCallbacks(hidePlayerControls);
        if (player != null && player.isPlaying() && !tvQueueOpen && !tvUpNextVisible) {
            playerView.postDelayed(hidePlayerControls, 4_500L);
        }
    }

    private void cancelPlayerControlsHide() {
        if (playerView != null) {
            playerView.removeCallbacks(hidePlayerControls);
        }
    }

    private long playerSeekStep(long heldForMs) {
        if (heldForMs >= 4_200L) {
            return 60_000L;
        }
        if (heldForMs >= 2_600L) {
            return 30_000L;
        }
        if (heldForMs >= 1_500L) {
            return 15_000L;
        }
        if (heldForMs >= 700L) {
            return 10_000L;
        }
        return PLAYER_SEEK_STEP_MS;
    }

    private long playerSeekRepeatInterval(long heldForMs) {
        if (heldForMs >= 3_000L) {
            return 75L;
        }
        if (heldForMs >= 1_600L) {
            return 100L;
        }
        if (heldForMs >= 700L) {
            return 130L;
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

    private boolean isMainPlayerControl(View v) {
        if (v == null) return false;
        return v == tvPrevButton || v == tvRewindButton || v == tvPlayPauseButton
            || v == tvForwardButton || v == tvNextButton || v == tvQueueButton
            || v == tvSpeedButton || v == tvTracksButton || v == tvAspectButton
            || v == tvRepeatButton || v == tvAutoplayButton || v == tvMoreButton;
    }

    private boolean isDescendantOf(View child, View container) {
        if (child == null || container == null) return false;
        View current = child;
        while (current != null) {
            if (current == container) return true;
            android.view.ViewParent parent = current.getParent();
            current = parent instanceof View ? (View) parent : null;
        }
        return false;
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
                    if (!"player".equals(page)) render();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    isLoading = false;
                    loadError = error.getMessage() == null ? "Не удалось загрузить данные с API." : error.getMessage();
                    if (!"player".equals(page)) render();
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
        if ((posterUrl.isEmpty() || posterUrl.contains("\\") || posterUrl.matches("^[A-Za-z]:.*")) && !id.isEmpty()) {
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
            item.optString("path", ""),
            item.optString("extension", "")
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
            } else if ("file".equals(type)) {
                JSONObject file = item.optJSONObject("file");
                FileEntry entry = FileEntry.file(file == null ? item : file);
                if (!entry.fileId.isEmpty()) result.add(entry);
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
        if (!"files".equals(page) || isEntriesLoading || !entriesError.isEmpty()) {
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
                List<FileEntry> nextEntries;
                try {
                    nextEntries = parseFileEntries(apiClient.getArray(path));
                } catch (ApiClient.ApiResponseException error) {
                    if (requestedFolderId != null || (error.status != 401 && error.status != 403)) throw error;
                    // Guests can browse the roots exposed by the public folders endpoint.
                    List<FileEntry> roots = new ArrayList<>();
                    for (SharedFolder folder : parseFolders(apiClient.getArray("/folders"))) {
                        if (folder.isRoot && folder.enabled) roots.add(FileEntry.folder(folder));
                    }
                    nextEntries = roots;
                }
                List<FileEntry> loaded = nextEntries;
                runOnUiThread(() -> {
                    if (requestVersion != entriesRequestVersion || !sameDirectory(requestedFolderId, currentDirectoryId)) {
                        return;
                    }
                    currentEntries.clear();
                    currentEntries.addAll(loaded);
                    repository.mergeFileEntries(loaded);
                    loadedEntriesDirectoryId = requestedFolderId;
                    hasLoadedEntries = true;
                    isEntriesLoading = false;
                    entriesError = "";
                    if ("files".equals(page)) render();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestVersion != entriesRequestVersion || !sameDirectory(requestedFolderId, currentDirectoryId)) {
                        return;
                    }
                    currentEntries.clear();
                    isEntriesLoading = false;
                    entriesError = error.getMessage() == null ? "Не удалось загрузить папку." : error.getMessage();
                    if ("files".equals(page)) render();
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
        if ("settings".equals(page) && !isAdmin) page = "videos";
        if ("admin".equals(page) && !isAdmin) page = accountLogin.isEmpty() ? "login" : "account";
        if ("account".equals(page) && accountLogin.isEmpty()) page = "login";
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
            appRootOverlayHost = new FrameLayout(this);
            appRootOverlayHost.setBackgroundColor(Color.BLACK);
            appRootOverlayHost.setClipChildren(false);
            appRootOverlayHost.setClipToPadding(false);
            root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setBackgroundColor(Color.BLACK);
            appRootOverlayHost.addView(root, new FrameLayout.LayoutParams(-1, -1));
            setContentView(appRootOverlayHost);
            renderPlayerPage();
            attachCastToastBanner(appRootOverlayHost);
            flushPendingCastToast();
            return;
        }

        tvNavRail = null;
        tvNavExpanded = false;
        controlsPanel = null;
        headerCastPill = null;
        headerCastDot = null;
        headerCastIcon = null;
        headerCastLabel = null;
        if (isTvLandscape()) {
            FrameLayout tvStage = new FrameLayout(this);
            tvStage.setBackgroundColor(BG);
            tvStage.setClipChildren(false);
            tvStage.setClipToPadding(false);
            appRootOverlayHost = tvStage;
            setContentView(tvStage);

            root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setBackgroundColor(BG);
            root.setClipChildren(false);
            root.setClipToPadding(false);
            FrameLayout.LayoutParams contentParams = new FrameLayout.LayoutParams(-1, -1);
            contentParams.leftMargin = dp(TV_NAV_COLLAPSED_WIDTH_DP + 16);
            tvStage.addView(root, contentParams);
            renderTvNavigation(tvStage);
        } else {
            FrameLayout mobileStage = new FrameLayout(this);
            mobileStage.setBackgroundColor(BG);
            mobileStage.setClipChildren(false);
            mobileStage.setClipToPadding(false);
            appRootOverlayHost = mobileStage;
            root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setBackgroundColor(BG);
            root.setClipChildren(false);
            root.setClipToPadding(false);
            mobileStage.addView(root, new FrameLayout.LayoutParams(-1, -1));
            setContentView(mobileStage);
        }

        mainScrollView = new ScrollView(this);
        mainScrollView.setVerticalScrollBarEnabled(false);
        mainScrollView.setFillViewport(true);
        mainScrollView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        mainScrollView.setFocusable(false);
        mainScrollView.setFocusableInTouchMode(false);
        mainScrollView.setClipChildren(false);
        mainScrollView.setClipToPadding(false);
        mainScrollView.setPadding(0, 0, 0, dp(8));
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setClipChildren(false);
        content.setClipToPadding(false);
        int sidePadding = isTvLandscape() ? dp(24) : (isTvLayout() ? dp(32) : dp(16));
        int bottomPadding = isTvLandscape() ? dp(32) : dp(isTvLayout() ? 104 : 92);
        content.setPadding(sidePadding, dp(isTvLandscape() ? 20 : 12), sidePadding, bottomPadding);
        mainScrollView.addView(content);
        root.addView(mainScrollView, new LinearLayout.LayoutParams(-1, 0, 1));
        renderHeader();

        if ("admin".equals(page)) {
            renderAdminPage();
        } else if ("settings".equals(page)) {
            renderSettingsPage();
        } else if ("login".equals(page)) {
            renderLoginPage();
        } else if ("account".equals(page)) {
            renderAccountPage();
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
        attachCastToastBanner(appRootOverlayHost);
        flushPendingCastToast();
        boolean restoringFocus = shouldRestoreListPosition;
        restoreListPositionIfNeeded();
        if (!restoringFocus) {
            focusTvDefaultIfNeeded();
        }
    }

    private void renderTvNavigation(FrameLayout shell) {
        LinearLayout rail = new LinearLayout(this);
        tvNavRail = rail;
        rail.setOrientation(LinearLayout.VERTICAL);
        rail.setClipChildren(false);
        rail.setClipToPadding(false);
        rail.setGravity(Gravity.CENTER_HORIZONTAL);
        rail.setPadding(dp(12), dp(22), dp(12), dp(22));
        // Floating soft capsule navigation rail (YouTube TV / VK Video TV style — zero border, 28dp rounded pill)
        rail.setBackground(makeMaterialSurfaceDrawable(SURFACE, 0, 28, 0));
        rail.setElevation(dp(24));

        LinearLayout brand = new LinearLayout(this);
        brand.setGravity(Gravity.CENTER);
        brand.setPadding(0, 0, 0, 0);
        brand.setTag("nav-row");

        FrameLayout brandMark = new FrameLayout(this);
        brandMark.setBackground(makeMaterialSurfaceDrawable(ACCENT, 0, 14, 0));
        ImageView brandPlay = new ImageView(this);
        brandPlay.setImageResource(R.drawable.ic_play_tv);
        brandPlay.setColorFilter(DARK);
        brandPlay.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        brandMark.addView(brandPlay, new FrameLayout.LayoutParams(dp(20), dp(20), Gravity.CENTER));
        brand.addView(brandMark, new LinearLayout.LayoutParams(dp(42), dp(42)));

        LinearLayout brandText = new LinearLayout(this);
        brandText.setOrientation(LinearLayout.VERTICAL);
        brandText.setGravity(Gravity.CENTER_VERTICAL);
        brandText.setPadding(dp(14), 0, 0, 0);
        brandText.setAlpha(0f);
        brandText.setVisibility(View.GONE);
        brandText.setTag("nav-label");
        TextView brandTitle = text("Video Vault", 16, Color.WHITE, true);
        brandTitle.setSingleLine(true);
        TextView brandSub = text("Медиатека", 11, MUTED, false);
        brandSub.setSingleLine(true);
        brandText.addView(brandTitle);
        brandText.addView(brandSub);
        brand.addView(brandText, new LinearLayout.LayoutParams(0, dp(42), 1));

        rail.addView(brand, new LinearLayout.LayoutParams(-1, dp(44)));
        addSpace(rail, 28);

        LinearLayout videosButton = navRailButton("Видео", "videos", R.drawable.ic_video_tv);
        LinearLayout filesButton = navRailButton("Файлы", "files", R.drawable.ic_folder_tv);
        LinearLayout adminButton = navRailButton(accountNavLabel(), accountNavPage(), R.drawable.ic_admin_tv);

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
        if (isAdmin) {
            LinearLayout settingsButton = navRailButton("Настройки", "settings", R.drawable.ic_admin_tv);
            videosButton.setNextFocusUpId(settingsButton.getId());
            adminButton.setNextFocusDownId(settingsButton.getId());
            settingsButton.setNextFocusUpId(adminButton.getId());
            settingsButton.setNextFocusDownId(videosButton.getId());
            addSpace(rail, 8);
            rail.addView(settingsButton);
        }

        FrameLayout.LayoutParams railParams = new FrameLayout.LayoutParams(dp(TV_NAV_COLLAPSED_WIDTH_DP), -1, Gravity.LEFT);
        railParams.setMargins(dp(14), dp(14), 0, dp(14));
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
        button.addView(icon, new LinearLayout.LayoutParams(dp(23), dp(23)));

        TextView title = text(label, 14, selected ? Color.WHITE : MUTED, true);
        title.setGravity(Gravity.CENTER_VERTICAL);
        title.setMaxLines(1);
        title.setAlpha(0f);
        title.setVisibility(View.GONE);
        title.setPadding(dp(14), 0, 0, 0);
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
        button.setOnClickListener(v -> openNavigationPage(targetPage));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(50));
        params.setMargins(0, 0, 0, dp(4));
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
            ? ACCENT
            : (selected ? ACCENT_SOFT : Color.TRANSPARENT);
        // Full capsule pill (999dp radius, zero border)
        button.setBackground(makeMaterialSurfaceDrawable(background, 0, 999, 0));
        title.setTextColor(hasFocus ? DARK : (selected ? Color.WHITE : MUTED));
        icon.setColorFilter(hasFocus ? DARK : (selected ? ACCENT : MUTED));
        button.setElevation(hasFocus ? dp(10) : 0);
        if (hasFocus) {
            allowFocusOverflow(button, null);
        }
    }

    private void setTvNavigationExpanded(boolean expanded) {
        if (tvNavRail == null || tvNavExpanded == expanded) {
            return;
        }
        tvNavExpanded = expanded;
        ViewGroup.LayoutParams params = tvNavRail.getLayoutParams();
        int targetWidth = dp(expanded ? TV_NAV_EXPANDED_WIDTH_DP : TV_NAV_COLLAPSED_WIDTH_DP);
        if (params.width != targetWidth) {
            params.width = targetWidth;
            tvNavRail.setLayoutParams(params);
        }
        updateNavigationLabels(expanded);
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
                navRow.setPadding(visible ? dp(14) : 0, 0, visible ? dp(14) : 0, 0);
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
        card.setPadding(dp(22), dp(20), dp(22), dp(20));
        card.addView(text(title, isTvLayout() ? 20 : 18, Color.WHITE, true));
        addSpace(card, 6);
        card.addView(text(message, isTvLayout() ? 14 : 14, MUTED, false));

        if (withRetry) {
            addSpace(card, 16);
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setClipChildren(false);
            row.setClipToPadding(false);

            TextView retry = actionButton("Повторить", CARD_ELEVATED, TEXT);
            retry.setOnClickListener(v -> refreshData());
            row.addView(retry, new LinearLayout.LayoutParams(-2, dp(44)));
            card.addView(row);
        }

        return withBottomMargin(card, 14);
    }

    private void renderHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setClipChildren(false);
        header.setClipToPadding(false);
        header.setPadding(0, 0, 0, dp(isTvLandscape() ? 14 : 10));

        LinearLayout titleBox = new LinearLayout(this);
        titleBox.setOrientation(LinearLayout.VERTICAL);
        titleBox.addView(text(pageTitle(), isTvLandscape() ? 28 : (isTvLayout() ? 32 : 26), Color.WHITE, true));
        header.addView(titleBox, new LinearLayout.LayoutParams(0, -2, 1));

        LinearLayout castPill = buildHeaderCastPill();
        header.addView(castPill, new LinearLayout.LayoutParams(-2, dp(40)));
        addInlineSpace(header, 10);

        TextView accountBtn = toolbarPillButton(accountLogin.isEmpty() ? "Войти" : accountLogin);
        accountBtn.setOnClickListener(v -> openNavigationPage(accountNavPage()));
        header.addView(accountBtn, new LinearLayout.LayoutParams(-2, dp(40)));

        content.addView(header);
    }

    private TextView toolbarPillButton(String label) {
        TextView btn = text(label, 13, TEXT, true);
        btn.setGravity(Gravity.CENTER);
        btn.setPadding(dp(18), 0, dp(18), 0);
        btn.setBackground(makeMaterialSurfaceDrawable(CARD, 0, 999, 0));
        applyFocus(btn, CARD, ACCENT, 999, 0);
        return btn;
    }

    private String pageTitle() {
        if ("login".equals(page)) return "Вход";
        if ("account".equals(page)) return "Мой аккаунт";
        if ("settings".equals(page)) return "Настройки";
        if ("files".equals(page)) {
            return "Все файлы";
        }
        if ("admin".equals(page)) {
            return "Админка";
        }
        return "Видео";
    }

    private void renderSearchAndMode() {
        controlsPanel = new LinearLayout(this);
        controlsPanel.setOrientation(LinearLayout.VERTICAL);
        controlsPanel.setClipChildren(false);
        controlsPanel.setClipToPadding(false);

        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setClipChildren(false);
        row.setClipToPadding(false);

        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setText(query);
        input.setHint("files".equals(page) ? "Поиск папок, видео и файлов…" : "Поиск видео…");
        input.setTextSize(isTvLandscape() ? 14 : (isTvLayout() ? 16 : 14));
        input.setTextColor(TEXT);
        input.setHintTextColor(MUTED);
        input.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        input.setPadding(dp(18), 0, dp(18), 0);
        input.setCompoundDrawablePadding(dp(10));
        Drawable searchIcon = getDrawable(R.drawable.ic_search_tv);
        if (searchIcon != null) {
            searchIcon.setTint(MUTED);
            searchIcon.setBounds(0, 0, dp(19), dp(19));
            input.setCompoundDrawables(searchIcon, null, null, null);
        }
        // Soft borderless search capsule (999dp radius)
        input.setBackground(makeMaterialSurfaceDrawable(CARD, 0, 999, 0));
        input.setOnEditorActionListener((v, actionId, event) -> {
            query = input.getText().toString();
            render();
            return true;
        });
        input.setOnFocusChangeListener((v, hasFocus) -> {
            input.setElevation(hasFocus ? dp(8) : 0);
            input.setBackground(makeMaterialSurfaceDrawable(
                hasFocus ? CARD_ELEVATED : CARD,
                hasFocus ? ACCENT : 0,
                999,
                hasFocus ? 2 : 0
            ));
            if (searchIcon != null) {
                searchIcon.setTint(hasFocus ? ACCENT : MUTED);
            }
            if (!hasFocus) {
                query = input.getText().toString();
            }
        });
        int controlHeight = isTvLandscape() ? 44 : (isTvLayout() ? 50 : 44);
        row.addView(input, new LinearLayout.LayoutParams(0, dp(controlHeight), 1));

        addInlineSpace(row, 10);
        if (isTvLandscape()) {
            if ("files".equals(page)) {
                TextView filter = fileTypeFilterButton();
                row.addView(filter, new LinearLayout.LayoutParams(-2, dp(controlHeight)));
                addInlineSpace(row, 8);
            }
            TextView sort = sortButton();
            row.addView(sort, new LinearLayout.LayoutParams(-2, dp(controlHeight)));
            addInlineSpace(row, 6);
            ImageView sortDir = sortDirectionButton(controlHeight);
            row.addView(sortDir);
            addInlineSpace(row, 8);
        }

        // Soft capsule view-mode switcher (999dp pill, zero border)
        LinearLayout segmented = new LinearLayout(this);
        segmented.setGravity(Gravity.CENTER_VERTICAL);
        segmented.setClipChildren(false);
        segmented.setClipToPadding(false);
        segmented.setPadding(dp(4), dp(4), dp(4), dp(4));
        segmented.setBackground(makeMaterialSurfaceDrawable(SURFACE, 0, 999, 0));
        segmented.addView(modeButton(R.drawable.ic_grid_tv, "grid", controlHeight - 8));
        addInlineSpace(segmented, 4);
        segmented.addView(modeButton(R.drawable.ic_list_tv, "list", controlHeight - 8));
        row.addView(segmented, new LinearLayout.LayoutParams(-2, dp(controlHeight)));

        controlsPanel.addView(row);

        if (!isTvLandscape()) {
            LinearLayout subRow = new LinearLayout(this);
            subRow.setGravity(Gravity.CENTER_VERTICAL);
            subRow.setClipChildren(false);
            subRow.setClipToPadding(false);
            LinearLayout.LayoutParams subParams = new LinearLayout.LayoutParams(-1, dp(controlHeight));
            subParams.setMargins(0, dp(8), 0, 0);
            if ("files".equals(page)) {
                TextView filter = fileTypeFilterButton();
                subRow.addView(filter, new LinearLayout.LayoutParams(0, dp(controlHeight), 1));
                addInlineSpace(subRow, 8);
            }
            TextView sort = sortButton();
            subRow.addView(sort, new LinearLayout.LayoutParams(0, dp(controlHeight), 1));
            addInlineSpace(subRow, 6);
            subRow.addView(sortDirectionButton(controlHeight));
            controlsPanel.addView(subRow, subParams);
        }
        content.addView(withBottomMargin(controlsPanel, isTvLandscape() ? 10 : 8));
    }

    private TextView fileTypeFilterButton() {
        TextView filter = toolbarPillButton(FILE_TYPES[fileTypeFilter] + " ▾");
        filter.setOnClickListener(v -> new MaterialAlertDialogBuilder(this)
            .setTitle("Тип содержимого")
            .setSingleChoiceItems(FILE_TYPES, fileTypeFilter, (dialog, index) -> {
                fileTypeFilter = index;
                dialog.dismiss();
                render();
            })
            .setNegativeButton("Отмена", null)
            .show());
        return filter;
    }

    private TextView sortButton() {
        String label = ("date".equals(sortField) ? "По дате" : "По имени") + " ▾";
        TextView button = toolbarPillButton(label);
        button.setContentDescription("Выбрать сортировку файлов");
        rememberTvFocus(button);
        button.setOnClickListener(v -> showSortDialog());
        return button;
    }

    private ImageView sortDirectionButton(int sizeDp) {
        ImageView button = new ImageView(this);
        button.setImageResource(sortAscending ? R.drawable.ic_sort_asc_tv : R.drawable.ic_sort_desc_tv);
        button.setContentDescription(sortAscending ? "По возрастанию" : "По убыванию");
        button.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        button.setPadding(dp(11), dp(11), dp(11), dp(11));
        button.setFocusable(true);
        button.setFocusableInTouchMode(isTvLayout());
        button.setBackground(makeMaterialSurfaceDrawable(CARD, 0, 999, 0));
        button.setColorFilter(TEXT);
        button.setOnFocusChangeListener((v, hasFocus) -> {
            if (hasFocus) {
                allowFocusOverflow(button, null);
            }
            button.setBackground(makeMaterialSurfaceDrawable(hasFocus ? ACCENT : CARD, 0, 999, 0));
            button.setColorFilter(hasFocus ? DARK : TEXT);
            button.setElevation(hasFocus ? dp(8) : 0);
        });
        button.setOnClickListener(v -> {
            sortAscending = !sortAscending;
            getPreferences(MODE_PRIVATE).edit().putBoolean("sortAscending", sortAscending).apply();
            render();
        });
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp)));
        return button;
    }

    private String sortButtonLabel() {
        if ("date".equals(sortField)) {
            return sortAscending ? "Дата: старые" : "Дата: новые";
        }
        return sortAscending ? "Имя: А-Я" : "Имя: Я-А";
    }

    private void showSortDialog() {
        String[] options = {"По имени (А–Я)", "По имени (Я–А)", "По дате (новые)", "По дате (старые)"};
        int selected = "date".equals(sortField) ? (sortAscending ? 3 : 2) : (sortAscending ? 0 : 1);
        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
            .setTitle("Сортировка")
            .setSingleChoiceItems(options, selected, null)
            .setNegativeButton("Отмена", null)
            .create();
        dialog.setOnShowListener(ignored -> {
            dialog.getListView().setOnItemClickListener((parent, view, position, id) -> {
                sortField = position >= 2 ? "date" : "name";
                sortAscending = position == 0 || position == 3;
                getPreferences(MODE_PRIVATE).edit()
                    .putString("sortField", sortField)
                    .putBoolean("sortAscending", sortAscending)
                    .apply();
                dialog.dismiss();
                render();
            });
        });
        dialog.show();
    }

    private ImageView modeButton(int iconResource, String mode, int sizeDp) {
        boolean selected = mode.equals(viewMode);
        ImageView button = new ImageView(this);
        button.setImageResource(iconResource);
        button.setContentDescription("grid".equals(mode) ? "Плитка" : "Список");
        button.setSelected(selected);
        button.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        button.setPadding(dp(8), dp(8), dp(8), dp(8));
        button.setFocusable(true);
        button.setFocusableInTouchMode(isTvLayout());
        updateModeButton(button, selected, false);
        button.setOnFocusChangeListener((view, hasFocus) -> updateModeButton((ImageView) view, selected, hasFocus));
        button.setOnClickListener(v -> {
            viewMode = mode;
            getPreferences(MODE_PRIVATE).edit().putString("viewMode", viewMode).apply();
            render();
        });
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(sizeDp + 6), dp(sizeDp)));
        return button;
    }

    private void updateModeButton(ImageView button, boolean selected, boolean hasFocus) {
        if (hasFocus) {
            allowFocusOverflow(button, null);
        }
        int bg = hasFocus ? ACCENT : (selected ? ACCENT_SOFT : Color.TRANSPARENT);
        button.setBackground(makeMaterialSurfaceDrawable(bg, 0, 999, 0));
        button.setColorFilter(hasFocus ? DARK : (selected ? ACCENT : MUTED));
        button.setElevation(hasFocus ? dp(6) : 0);
    }

    private void renderVideosPage() {
        renderFolderChips();
        List<VideoFile> list = sortVideos(repository.getVideos(selectedFolderId, query));
        renderCollectionHeading(list.size());
        if (list.isEmpty()) {
            content.addView(emptyVideosCard());
            return;
        }
        LinearLayout listPanel = contentListContainer();
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

    private void renderCollectionHeading(int count) {
        LinearLayout heading = new LinearLayout(this);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        heading.setPadding(0, dp(2), 0, dp(12));

        String titleText = !query.trim().isEmpty()
            ? "Результаты поиска"
            : ("all".equals(selectedFolderId) ? "Вся коллекция" : selectedFolderName());
        heading.addView(text(titleText, 16, Color.WHITE, true));
        addInlineSpace(heading, 10);

        TextView badge = text(String.valueOf(count), 12, ACCENT, true);
        badge.setPadding(dp(10), dp(2), dp(10), dp(2));
        badge.setBackground(makeMaterialSurfaceDrawable(ACCENT_SOFT, 0, 999, 0));
        heading.addView(badge);

        View spacer = new View(this);
        heading.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1));
        heading.addView(text("Локальная библиотека", 12, MUTED, false));

        content.addView(heading);
    }

    private String selectedFolderName() {
        for (SharedFolder folder : repository.getEnabledFolders()) {
            if (folder.id.equals(selectedFolderId)) {
                return folder.name;
            }
        }
        return "Коллекция";
    }

    private View emptyVideosCard() {
        LinearLayout card = card();
        card.setGravity(Gravity.CENTER);
        card.setPadding(dp(24), dp(isTvLandscape() ? 42 : 48), dp(24), dp(isTvLandscape() ? 42 : 48));
        card.addView(text(query.isEmpty() ? "В коллекции пока нет видео" : "Ничего не нашлось", 19, Color.WHITE, true));
        addSpace(card, 6);
        card.addView(text(query.isEmpty() ? "Добавленные видео появятся в этой коллекции." : "Попробуйте другое название или выберите другую папку.", 13, MUTED, false));
        return card;
    }

    private void renderFolderChips() {
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        scroll.setClipChildren(false);
        scroll.setClipToPadding(false);
        scroll.setPadding(dp(4), dp(12), dp(4), dp(8));
        scroll.setFocusable(false);
        scroll.setFocusableInTouchMode(false);
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setClipChildren(false);
        row.setClipToPadding(false);
        row.setPadding(0, 0, 0, 0);
        int allCount = repository.getVideos("all", "").size();
        TextView all = chip("Все видео  " + allCount, "all".equals(selectedFolderId));
        all.setOnClickListener(v -> {
            selectedFolderId = "all";
            page = "videos";
            render();
        });
        row.addView(all);
        for (SharedFolder folder : repository.getEnabledFolders()) {
            String chipLabel = folder.filesCount > 0 ? folder.name + "  " + folder.filesCount : folder.name;
            TextView chip = chip(chipLabel, folder.id.equals(selectedFolderId));
            chip.setOnClickListener(v -> {
                selectedFolderId = folder.id;
                page = "videos";
                render();
            });
            row.addView(chip);
        }
        scroll.addView(row);
        (controlsPanel == null ? content : controlsPanel).addView(scroll);
    }

    private void renderFilesPage() {
        renderBreadcrumbs();
        ensureDirectoryEntriesLoaded();
        List<FileEntry> entries = sortEntries(filterEntries(currentEntries, query));
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

        LinearLayout listPanel = contentListContainer();
        content.addView(listPanel);
        if ("grid".equals(viewMode)) {
            renderEntryGrid(entries, listPanel);
        } else {
            for (FileEntry entry : entries) {
                View card = entryCard(entry, false);
                rememberTvFocus(card);
                listPanel.addView(card);
            }
        }
    }

    private List<FileEntry> filterEntries(List<FileEntry> entries, String searchQuery) {
        String normalized = searchQuery == null ? "" : searchQuery.trim().toLowerCase();
        List<FileEntry> result = new ArrayList<>();
        for (FileEntry entry : entries) {
            if (entry.type == FileEntry.Type.FOLDER && entry.folder != null) {
                String haystack = (entry.folder.name + " " + entry.folder.path).toLowerCase();
                if (haystack.contains(normalized)) {
                    result.add(entry);
                }
            } else if (entry.video != null && (fileTypeFilter == 0 || fileTypeFilter == 3)) {
                String haystack = (entry.video.title + " " + entry.video.folderName + " " + entry.video.codec + " "
                    + entry.video.resolution + " " + entry.video.path).toLowerCase();
                if (haystack.contains(normalized)) {
                    result.add(entry);
                }
            } else if (entry.type == FileEntry.Type.FILE
                && (fileTypeFilter == 3 || (fileTypeFilter == 2 && entry.image) || (fileTypeFilter == 1 && !entry.image))
                && entry.fileName.toLowerCase(Locale.ROOT).contains(normalized)) {
                result.add(entry);
            }
        }
        return result;
    }

    private List<VideoFile> sortVideos(List<VideoFile> videos) {
        List<VideoFile> result = new ArrayList<>(videos);
        Collections.sort(result, (left, right) -> {
            int comparison = "date".equals(sortField)
                ? compareDates(left.modifiedAt, right.modifiedAt)
                : compareNames(left.title, right.title);
            return comparison != 0 ? comparison : nameCollator.compare(left.title, right.title);
        });
        return result;
    }

    private List<FileEntry> sortEntries(List<FileEntry> entries) {
        List<FileEntry> result = new ArrayList<>(entries);
        Collections.sort(result, (left, right) -> {
            boolean leftIsFolder = left.type == FileEntry.Type.FOLDER;
            boolean rightIsFolder = right.type == FileEntry.Type.FOLDER;
            if (leftIsFolder != rightIsFolder) {
                return leftIsFolder ? -1 : 1;
            }

            int comparison = "date".equals(sortField)
                ? compareDates(entryDate(left), entryDate(right))
                : compareNames(entryName(left), entryName(right));
            return comparison != 0 ? comparison : nameCollator.compare(entryName(left), entryName(right));
        });
        return result;
    }

    private int compareNames(String left, String right) {
        int comparison = nameCollator.compare(safeText(left), safeText(right));
        return sortAscending ? comparison : -comparison;
    }

    private int compareDates(String left, String right) {
        boolean leftMissing = safeText(left).isEmpty();
        boolean rightMissing = safeText(right).isEmpty();
        if (leftMissing != rightMissing) {
            return leftMissing ? 1 : -1;
        }
        int comparison = safeText(left).compareToIgnoreCase(safeText(right));
        return sortAscending ? comparison : -comparison;
    }

    private String entryName(FileEntry entry) {
        return entry.type == FileEntry.Type.FOLDER && entry.folder != null
            ? entry.folder.name
            : (entry.video == null ? entry.fileName : entry.video.title);
    }

    private String entryDate(FileEntry entry) {
        return entry.type == FileEntry.Type.FOLDER && entry.folder != null
            ? entry.folder.lastScanAt
            : (entry.video == null ? entry.modifiedAt : entry.video.modifiedAt);
    }

    private String safeText(String value) {
        return value == null ? "" : value.trim();
    }

    private void renderBreadcrumbs() {
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        scroll.setClipChildren(false);
        scroll.setClipToPadding(false);
        scroll.setPadding(dp(4), dp(12), dp(4), dp(8));
        scroll.setFocusable(false);
        scroll.setFocusableInTouchMode(false);
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setClipChildren(false);
        row.setClipToPadding(false);

        TextView rootChip = chip("Все папки", currentDirectoryId == null);
        rootChip.setOnClickListener(v -> {
            currentDirectoryId = null;
            invalidateDirectoryEntries();
            render();
        });
        row.addView(rootChip);

        for (SharedFolder directory : repository.getBreadcrumbs(currentDirectoryId)) {
            TextView sep = text("›", 15, MUTED, true);
            sep.setPadding(0, 0, dp(8), 0);
            row.addView(sep);
            TextView crumb = chip(directory.name, directory.id.equals(currentDirectoryId));
            crumb.setOnClickListener(v -> {
                currentDirectoryId = directory.id;
                invalidateDirectoryEntries();
                render();
            });
            row.addView(crumb);
        }
        scroll.addView(row);
        (controlsPanel == null ? content : controlsPanel).addView(scroll);
    }

    private void renderCompactSummary(List<FileEntry> entries) {
        int folders = 0;
        int videos = 0;
        int files = 0;
        for (FileEntry entry : entries) {
            if (entry.type == FileEntry.Type.FOLDER) {
                folders++;
            } else if (entry.type == FileEntry.Type.VIDEO) {
                videos++;
            } else {
                files++;
            }
        }
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(2), 0, dp(12));
        SharedFolder currentDirectory = repository.getDirectory(currentDirectoryId);
        String current = currentDirectoryId == null ? "Корень" : (currentDirectory == null ? "Папка" : currentDirectory.name);
        row.addView(text(current, 16, Color.WHITE, true));
        addInlineSpace(row, 10);
        row.addView(summaryBadge(folders + " папок"));
        addInlineSpace(row, 6);
        row.addView(summaryBadge(videos + " видео"));
        if (files > 0) {
            addInlineSpace(row, 6);
            row.addView(summaryBadge(files + " файлов"));
        }
        content.addView(row);
    }

    private TextView summaryBadge(String label) {
        TextView badge = text(label, 11, MUTED, true);
        badge.setPadding(dp(10), dp(3), dp(10), dp(3));
        badge.setBackground(makeMaterialSurfaceDrawable(CARD, 0, 999, 0));
        return badge;
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
                row.setPadding(0, dp(6), 0, dp(8));
                parent.addView(withBottomMargin(row, isTvLandscape() ? 12 : (isTvLayout() ? 14 : 10)));
            }
            View card = videoCard(videos.get(i), true);
            rememberTvFocus(card);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -2, 1);
            params.setMargins(column == 0 ? 0 : dp(9), 0, column == columns - 1 ? 0 : dp(9), 0);
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
                row.setPadding(0, dp(6), 0, dp(8));
                parent.addView(withBottomMargin(row, isTvLandscape() ? 12 : (isTvLayout() ? 14 : 10)));
            }
            FileEntry entry = entries.get(i);
            View card = entryCard(entry, true);
            rememberTvFocus(card);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -2, 1);
            params.setMargins(column == 0 ? 0 : dp(9), 0, column == columns - 1 ? 0 : dp(9), 0);
            row.addView(card, params);
        }
        fillGridTail(row, entries.size(), columns);
    }

    private View entryCard(FileEntry entry, boolean compact) {
        switch (entry.type) {
            case FOLDER: return folderCard(entry.folder, compact);
            case VIDEO: return videoCard(entry.video, compact);
            default:
                return sharedFileCard(entry, compact);
        }
    }

    private View sharedFileCard(FileEntry entry, boolean compact) {
        String ext = entry.extension == null || entry.extension.trim().isEmpty()
            ? "ФАЙЛ"
            : entry.extension.trim().replace(".", "").toUpperCase(Locale.ROOT);
        String extBadgeText = "ФАЙЛ".equals(ext) ? ext : "." + ext;

        if (!compact) {
            LinearLayout rowCard = card();
            rowCard.setOrientation(LinearLayout.HORIZONTAL);
            rowCard.setGravity(Gravity.CENTER_VERTICAL);
            rowCard.setPadding(dp(16), dp(12), dp(16), dp(12));

            TextView badgeBox = text(ext, 11, ACCENT, true);
            badgeBox.setGravity(Gravity.CENTER);
            badgeBox.setBackground(makeMaterialSurfaceDrawable(FOLDER_BG, 0, 14, 0));
            rowCard.addView(badgeBox, new LinearLayout.LayoutParams(dp(48), dp(48)));

            LinearLayout copy = new LinearLayout(this);
            copy.setOrientation(LinearLayout.VERTICAL);
            copy.setPadding(dp(14), 0, dp(12), 0);
            TextView name = text(entry.fileName, 14, TEXT, true);
            name.setMaxLines(1);
            name.setEllipsize(TextUtils.TruncateAt.END);
            copy.addView(name);
            addSpace(copy, 3);
            copy.addView(text(extBadgeText + "  •  " + formatBytes(entry.sizeBytes), 12, MUTED, false));
            rowCard.addView(copy, new LinearLayout.LayoutParams(0, -2, 1));

            bindFileCardActions(rowCard, entry);
            applyCardSurfaceFocus(rowCard, CARD, CARD_ELEVATED, 18);
            return withBottomMargin(rowCard, 10);
        }

        // Borderless Grid File Card (YouTube / VK Video style: rounded 16dp tile + floating text below)
        LinearLayout card = mediaCard();
        FrameLayout preview = new SixteenNineFrameLayout(this);
        preview.setBackground(makeMaterialSurfaceDrawable(POSTER_BG, 0, 16, 0));
        preview.setClipToOutline(true);

        TextView iconBox = text(ext, 12, ACCENT, true);
        iconBox.setGravity(Gravity.CENTER);
        iconBox.setBackground(makeMaterialSurfaceDrawable(FOLDER_BG, 0, 16, 0));
        preview.addView(iconBox, new FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER));

        View focusRing = new View(this);
        focusRing.setBackground(makeMaterialSurfaceDrawable(Color.TRANSPARENT, ACCENT, 16, 3));
        focusRing.setAlpha(0f);
        preview.addView(focusRing, new FrameLayout.LayoutParams(-1, -1));

        card.addView(preview, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout info = new LinearLayout(this);
        info.setOrientation(LinearLayout.VERTICAL);
        info.setPadding(dp(4), dp(10), dp(4), dp(4));
        TextView name = text(entry.fileName, 14, TEXT, true);
        name.setMaxLines(2);
        name.setEllipsize(TextUtils.TruncateAt.END);
        info.addView(name);
        addSpace(info, 3);
        info.addView(text(extBadgeText + "  •  " + formatBytes(entry.sizeBytes), 12, MUTED, false));

        card.addView(info);
        bindFileCardActions(card, entry);
        applyMediaCardFocus(card, preview, name, null, focusRing);
        return card;
    }

    private void bindFileCardActions(View fileCard, FileEntry entry) {
        fileCard.setOnClickListener(v -> {
            if (entry.image) showImage(entry);
            else confirmDownload(entry);
        });
        fileCard.setOnLongClickListener(v -> {
            if (isAdmin) {
                new MaterialAlertDialogBuilder(this).setTitle(entry.fileName)
                    .setItems(new String[]{"Скачать", "Удалить файл"}, (d, choice) -> {
                        if (choice == 0) confirmDownload(entry);
                        else confirmMediaDelete(entry.fileName, "/files/" + Uri.encode(entry.fileId));
                    }).show();
            } else {
                confirmDownload(entry);
            }
            return true;
        });
    }

    private Request downloadRequest(FileEntry entry) {
        return apiClient.request("/files/" + Uri.encode(entry.fileId) + "/download");
    }

    private void confirmDownload(FileEntry entry) {
        new MaterialAlertDialogBuilder(this).setTitle("Скачать файл?")
            .setMessage(entry.fileName)
            .setNegativeButton("Отмена", null)
            .setPositiveButton("Скачать", (dialog, which) -> downloadFile(entry)).show();
    }

    private void downloadFile(FileEntry entry) {
        try {
            Request source = downloadRequest(entry);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(source.url().toString()));
            String name = entry.fileName.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
            if (name.trim().isEmpty() || ".".equals(name) || "..".equals(name)) name = "download";
            request.setTitle(name);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (android.os.Build.VERSION.SDK_INT >= 29 && getApplicationInfo().targetSdkVersion >= 29) {
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            } else {
                request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name);
            }
            String auth = source.header("Authorization");
            if (auth != null) request.addRequestHeader("Authorization", auth);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
            android.widget.Toast.makeText(this, "Скачивание началось", android.widget.Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            toastDialog("Ошибка скачивания", safeText(error.getMessage()));
        }
    }

    private void showImage(FileEntry entry) {
        ImageView image = new ImageView(this);
        image.setAdjustViewBounds(true);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setMinimumHeight(dp(180));
        ScaleGestureDetector zoom = new ScaleGestureDetector(this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override public boolean onScale(ScaleGestureDetector detector) {
                float scale = Math.max(1f, Math.min(4f, image.getScaleX() * detector.getScaleFactor()));
                image.setScaleX(scale);
                image.setScaleY(scale);
                return true;
            }
        });
        image.setOnTouchListener((v, event) -> zoom.onTouchEvent(event));
        TextView status = text("Загрузка…", 14, TEXT, false);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(12), dp(8), dp(12), dp(8));
        body.addView(image, new LinearLayout.LayoutParams(-1, dp(300)));
        body.addView(status);
        AlertDialog dialog = new MaterialAlertDialogBuilder(this).setTitle(entry.fileName).setView(body)
            .setNegativeButton("Закрыть", null)
            .setPositiveButton("Скачать", (d, which) -> downloadFile(entry)).show();
        okhttp3.Call call = apiClient.client().newCall(downloadRequest(entry));
        dialog.setOnDismissListener(d -> call.cancel());
        posterExecutor.execute(() -> {
            Bitmap preview = null;
            try (Response response = call.execute()) {
                if (response.isSuccessful() && response.body() != null) {
                    BitmapFactory.Options options = new BitmapFactory.Options();
                    options.inSampleSize = entry.sizeBytes > 4 * 1024 * 1024 ? 4 : 2;
                    preview = BitmapFactory.decodeStream(response.body().byteStream(), null, options);
                }
            } catch (Exception ignored) {
                // The dialog still offers a download.
            }
            Bitmap result = preview;
            runOnUiThread(() -> {
                if (!dialog.isShowing()) return;
                if (result != null) {
                    image.setImageBitmap(result);
                    status.setVisibility(View.GONE);
                } else {
                    status.setText("Не удалось открыть изображение");
                }
            });
        });
    }

    private View videoCard(VideoFile video, boolean compact) {
        LinearLayout card = compact ? mediaCard() : card();
        card.setTag("video:" + video.id);
        card.setContentDescription("Открыть видео: " + video.title
            + (video.duration == null || video.duration.isEmpty() ? "" : ", " + video.duration));
        card.setOnClickListener(v -> openPlayer(video));
        card.setOnLongClickListener(v -> {
            List<String> actions = new ArrayList<>();
            List<Runnable> handlers = new ArrayList<>();
            if (!getCastTargetDevices().isEmpty()) {
                actions.add("Отправить на ТВ");
                handlers.add(() -> showCastVideoPicker(video, "replace"));
                actions.add("Добавить в очередь ТВ");
                handlers.add(() -> showCastVideoPicker(video, "append"));
            }
            if (isAdmin) {
                actions.add("Заменить постер");
                handlers.add(() -> pickPoster(video));
                actions.add("Удалить видео");
                handlers.add(() -> confirmMediaDelete(video.title, "/videos/" + Uri.encode(video.id)));
            }
            if (actions.isEmpty()) {
                return false;
            }
            new MaterialAlertDialogBuilder(this).setTitle(video.title)
                .setItems(actions.toArray(new String[0]), (dialog, choice) -> handlers.get(choice).run())
                .show();
            return true;
        });

        if (!compact) {
            // Soft horizontal list card (borderless, 18dp radius)
            card.setOrientation(LinearLayout.HORIZONTAL);
            card.setGravity(Gravity.CENTER_VERTICAL);
            card.setPadding(dp(10), dp(10), dp(16), dp(10));
        }

        FrameLayout poster = compact ? new SixteenNineFrameLayout(this) : new FrameLayout(this);
        poster.setBackground(makeMaterialSurfaceDrawable(POSTER_BG, 0, compact ? 16 : 14, 0));
        poster.setClipToOutline(true);

        ImageView placeholderIcon = new ImageView(this);
        placeholderIcon.setImageResource(R.drawable.ic_video_tv);
        placeholderIcon.setColorFilter(Color.rgb(88, 96, 110));
        placeholderIcon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        FrameLayout.LayoutParams placeholderParams = new FrameLayout.LayoutParams(dp(32), dp(32), Gravity.CENTER);
        poster.addView(placeholderIcon, placeholderParams);

        ImageView posterImage = new ImageView(this);
        posterImage.setScaleType(ImageView.ScaleType.CENTER_CROP);
        posterImage.setAlpha(0f);
        poster.addView(posterImage, new FrameLayout.LayoutParams(-1, -1));
        loadPosterInto(posterImage, video);

        // Soft bottom vignette on thumbnail
        View scrim = new View(this);
        GradientDrawable scrimGrad = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{Color.TRANSPARENT, Color.argb(150, 8, 9, 12)}
        );
        scrim.setBackground(scrimGrad);
        poster.addView(scrim, new FrameLayout.LayoutParams(-1, dp(56), Gravity.BOTTOM));

        // Circular warm-amber Play Badge in bottom-left
        FrameLayout playBadge = new FrameLayout(this);
        playBadge.setBackground(makeMaterialSurfaceDrawable(ACCENT_LIGHT, 0, 999, 0));
        ImageView playIcon = new ImageView(this);
        playIcon.setImageResource(R.drawable.ic_play_tv);
        playIcon.setColorFilter(DARK);
        playIcon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        playBadge.addView(playIcon, new FrameLayout.LayoutParams(dp(16), dp(16), Gravity.CENTER));
        int badgeSize = dp(compact ? 32 : 34);
        FrameLayout.LayoutParams playParams = new FrameLayout.LayoutParams(badgeSize, badgeSize, Gravity.BOTTOM | Gravity.LEFT);
        playParams.setMargins(dp(10), 0, 0, dp(10));
        poster.addView(playBadge, playParams);

        // Borderless rounded Duration Pill in bottom-right (YouTube / VK Video style)
        if (video.duration != null && !video.duration.trim().isEmpty()) {
            TextView duration = text(video.duration, 11, Color.WHITE, true);
            duration.setGravity(Gravity.CENTER);
            duration.setPadding(dp(8), dp(3), dp(8), dp(3));
            duration.setBackground(makeMaterialSurfaceDrawable(Color.argb(210, 10, 11, 14), 0, 8, 0));
            FrameLayout.LayoutParams durationParams = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.RIGHT);
            durationParams.setMargins(0, 0, dp(10), dp(10));
            poster.addView(duration, durationParams);
        }

        // YouTube-style thin watch progress bar along the bottom of the thumbnail
        float watchedFraction = getSavedVideoProgressFraction(video.id);
        if (watchedFraction > 0.02f) {
            addThumbnailProgressBar(poster, watchedFraction);
        }

        // Focus ring overlay on the 16:9 thumbnail itself (only visible when focused via TV remote)
        View focusRing = new View(this);
        focusRing.setBackground(makeMaterialSurfaceDrawable(Color.TRANSPARENT, ACCENT, compact ? 16 : 14, 3));
        focusRing.setAlpha(0f);
        poster.addView(focusRing, new FrameLayout.LayoutParams(-1, -1));

        if (compact) {
            card.addView(poster, new LinearLayout.LayoutParams(-1, -2));
        } else {
            int listPosterW = dp(isTvLayout() ? 192 : 140);
            int listPosterH = Math.round(listPosterW * 9f / 16f);
            card.addView(poster, new LinearLayout.LayoutParams(listPosterW, listPosterH));
        }

        // Clean borderless metadata below thumbnail (YouTube / VK Video / Rutube style — no outer box, no divider line)
        LinearLayout info = new LinearLayout(this);
        info.setOrientation(LinearLayout.VERTICAL);
        if (compact) {
            info.setPadding(dp(4), dp(10), dp(4), dp(4));
        } else {
            info.setPadding(dp(16), dp(4), dp(4), dp(4));
        }

        TextView title = text(video.title, compact ? 14 : 16, TEXT, true);
        title.setMaxLines(2);
        title.setEllipsize(TextUtils.TruncateAt.END);
        info.addView(title);

        StringBuilder metaBuilder = new StringBuilder();
        if (video.folderName != null && !video.folderName.trim().isEmpty()) {
            metaBuilder.append(video.folderName.trim());
        }
        if (video.size != null && !video.size.trim().isEmpty()) {
            if (metaBuilder.length() > 0) metaBuilder.append("  •  ");
            metaBuilder.append(video.size.trim());
        }
        if (video.resolution != null && !video.resolution.trim().isEmpty()) {
            if (metaBuilder.length() > 0) metaBuilder.append("  •  ");
            metaBuilder.append(video.resolution.trim());
        }
        TextView metaText = text(metaBuilder.toString(), 12, MUTED, false);
        metaText.setSingleLine(true);
        metaText.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams metaParams = new LinearLayout.LayoutParams(-1, -2);
        metaParams.setMargins(0, dp(4), 0, 0);
        info.addView(metaText, metaParams);

        if (compact) {
            card.addView(info, new LinearLayout.LayoutParams(-1, -2));
            applyMediaCardFocus(card, poster, title, playBadge, focusRing);
            return card;
        } else {
            card.addView(info, new LinearLayout.LayoutParams(0, -2, 1));
            applyCardSurfaceFocus(card, CARD, CARD_ELEVATED, 18);
            return withBottomMargin(card, 10);
        }
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

    private void confirmMediaDelete(String name, String route) {
        new MaterialAlertDialogBuilder(this).setTitle("Удалить файл с сервера?")
            .setMessage(name).setNegativeButton("Отмена", null)
            .setPositiveButton("Удалить", (dialog, button) -> new Thread(() -> {
                try {
                    apiClient.delete(route);
                    runOnUiThread(this::refreshData);
                } catch (Exception error) {
                    runOnUiThread(() -> toastDialog("Ошибка удаления", safeText(error.getMessage())));
                }
            }).start()).show();
    }

    private static final int PICK_POSTER = 42;
    private VideoFile posterTarget;

    private void pickPoster(VideoFile video) {
        android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT)
            .setType("image/*").addCategory(android.content.Intent.CATEGORY_OPENABLE);
        try {
            posterTarget = video;
            startActivityForResult(intent, PICK_POSTER);
        } catch (android.content.ActivityNotFoundException error) {
            posterTarget = null;
            toastDialog("Постер", "На устройстве нет приложения для выбора изображений.");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_POSTER) return;
        VideoFile video = posterTarget;
        posterTarget = null;
        if (video == null || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri image = data.getData();
        new Thread(() -> {
            try {
                apiClient.uploadPoster("/videos/" + Uri.encode(video.id) + "/poster", getContentResolver(), image);
                posterCache.remove(video.posterUrl);
                runOnUiThread(this::refreshData);
            } catch (Exception error) {
                runOnUiThread(() -> toastDialog("Ошибка замены постера", safeText(error.getMessage())));
            }
        }).start();
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
        castSenderName = "";
        isRemoteQueueActive = false;
        locallyStartedVideoId = video == null ? "" : video.id;
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
            for (FileEntry entry : sortEntries(filterEntries(currentEntries, query))) {
                if (entry.type == FileEntry.Type.VIDEO && entry.video != null) {
                    playbackQueue.add(entry.video);
                }
            }
        } else {
            playbackQueue.addAll(sortVideos(repository.getVideos(selectedFolderId, query)));
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
        castSenderName = "";
        isRemoteQueueActive = false;
        locallyStartedVideoId = "";
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
        applyCardSurfaceFocus(card, CARD, CARD_ELEVATED, 18);
        card.setPadding(dp(14), dp(12), dp(16), dp(12));
        card.setOnClickListener(v -> {
            currentDirectoryId = directory.id;
            invalidateDirectoryEntries();
            render();
        });

        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.ic_folder_filled_tv);
        icon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        icon.setColorFilter(ACCENT);
        icon.setBackground(makeMaterialSurfaceDrawable(FOLDER_BG, 0, 14, 0));
        icon.setPadding(dp(10), dp(10), dp(10), dp(10));
        row.addView(icon, new LinearLayout.LayoutParams(dp(44), dp(44)));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.setPadding(dp(14), 0, dp(12), 0);
        copy.addView(text(directory.name, 15, TEXT, true));
        String meta = (directory.childFolderCount == 0 && directory.videoCount == 0)
            ? "Пустая папка"
            : directory.childFolderCount + " папок  •  " + directory.videoCount + " видео";
        copy.addView(text(meta, 12, MUTED, false));
        row.addView(copy, new LinearLayout.LayoutParams(0, -2, 1));

        ImageView chevron = new ImageView(this);
        chevron.setImageResource(R.drawable.ic_chevron_right_tv);
        chevron.setColorFilter(MUTED);
        row.addView(chevron, new LinearLayout.LayoutParams(dp(18), dp(18)));

        card.addView(row);
        return withBottomMargin(card, 10);
    }

    private View folderGridCard(SharedFolder directory) {
        // YouTube / VK Video Playlist Stack style: borderless 16dp rounded tile + top stack tab + floating title
        LinearLayout card = mediaCard();
        card.setTag("folder:" + directory.id);
        card.setContentDescription("Открыть папку: " + directory.name);
        card.setOnClickListener(v -> {
            currentDirectoryId = directory.id;
            invalidateDirectoryEntries();
            render();
        });

        // Subtle playlist stack bar above the folder thumbnail
        View stackTab = new View(this);
        stackTab.setBackground(makeMaterialSurfaceDrawable(Color.rgb(34, 29, 22), 0, 8, 0));
        LinearLayout.LayoutParams stackParams = new LinearLayout.LayoutParams(-1, dp(5));
        stackParams.setMargins(dp(16), 0, dp(16), dp(3));
        card.addView(stackTab, stackParams);

        FrameLayout poster = new SixteenNineFrameLayout(this);
        poster.setBackground(makeMaterialSurfaceDrawable(FOLDER_BG, 0, 16, 0));
        poster.setClipToOutline(true);

        // Soft glowing circular backdrop behind the folder icon
        FrameLayout iconCircle = new FrameLayout(this);
        iconCircle.setBackground(makeMaterialSurfaceDrawable(Color.rgb(58, 47, 32), 0, 999, 0));
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.ic_folder_filled_tv);
        icon.setColorFilter(ACCENT);
        icon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        iconCircle.addView(icon, new FrameLayout.LayoutParams(dp(34), dp(34), Gravity.CENTER));
        poster.addView(iconCircle, new FrameLayout.LayoutParams(dp(64), dp(64), Gravity.CENTER));

        // Bottom-right video count pill
        String badgeLabel = (directory.childFolderCount == 0 && directory.videoCount == 0)
            ? "Пустая"
            : directory.videoCount + " видео";
        TextView countBadge = text(badgeLabel, 11, ACCENT_LIGHT, true);
        countBadge.setGravity(Gravity.CENTER);
        countBadge.setPadding(dp(9), dp(3), dp(9), dp(3));
        countBadge.setBackground(makeMaterialSurfaceDrawable(Color.argb(200, 15, 16, 20), 0, 8, 0));
        FrameLayout.LayoutParams countParams = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.RIGHT);
        countParams.setMargins(0, 0, dp(10), dp(10));
        poster.addView(countBadge, countParams);

        View focusRing = new View(this);
        focusRing.setBackground(makeMaterialSurfaceDrawable(Color.TRANSPARENT, ACCENT, 16, 3));
        focusRing.setAlpha(0f);
        poster.addView(focusRing, new FrameLayout.LayoutParams(-1, -1));

        card.addView(poster, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout info = new LinearLayout(this);
        info.setOrientation(LinearLayout.VERTICAL);
        info.setPadding(dp(4), dp(10), dp(4), dp(4));

        TextView name = text(directory.name, 14, TEXT, true);
        name.setMaxLines(2);
        name.setEllipsize(TextUtils.TruncateAt.END);
        info.addView(name);

        String meta = (directory.childFolderCount == 0 && directory.videoCount == 0)
            ? "Пустая папка"
            : directory.childFolderCount + " папок  •  " + directory.videoCount + " видео";
        TextView metaView = text(meta, 12, MUTED, false);
        metaView.setSingleLine(true);
        metaView.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams metaParams = new LinearLayout.LayoutParams(-1, -2);
        metaParams.setMargins(0, dp(4), 0, 0);
        info.addView(metaView, metaParams);

        card.addView(info);
        applyMediaCardFocus(card, poster, name, iconCircle, focusRing);
        return card;
    }

    private View emptyCard() {
        LinearLayout card = card();
        card.setGravity(Gravity.CENTER);
        card.setPadding(dp(24), dp(isTvLandscape() ? 42 : 48), dp(24), dp(isTvLandscape() ? 42 : 48));
        card.addView(text("Нет содержимого типа «" + FILE_TYPES[fileTypeFilter] + "»", 19, Color.WHITE, true));
        addSpace(card, 6);
        card.addView(text("Выберите другой тип в фильтре или откройте другую папку.", 13, MUTED, false));
        return card;
    }

    private void renderAdminPage() {
        LinearLayout form = card();
        form.setPadding(dp(20), dp(20), dp(20), dp(20));
        form.addView(text("Добавить сетевую или локальную папку", 16, Color.WHITE, true));
        addSpace(form, 12);
        EditText path = input("Путь к папке", "D:\\Video");
        form.addView(path, new LinearLayout.LayoutParams(-1, dp(46)));
        addSpace(form, 12);
        TextView add = actionButton("Добавить папку", CARD_ELEVATED, TEXT);
        add.setOnClickListener(v -> addFolder(path.getText().toString()));
        form.addView(add, new LinearLayout.LayoutParams(-1, dp(46)));
        content.addView(withBottomMargin(form, 14));

        for (SharedFolder folder : repository.getFolders()) {
            content.addView(adminFolderCard(folder));
        }

        TextView logout = actionButton("Выйти из аккаунта", CARD, TEXT);
        logout.setOnClickListener(v -> logout());
        content.addView(withBottomMargin(logout, 12));
    }

    private void renderLoginPage() {
        FrameLayout wrapper = new FrameLayout(this);
        wrapper.setClipChildren(false);
        wrapper.setClipToPadding(false);
        wrapper.setPadding(0, dp(isTvLandscape() ? 18 : 8), 0, dp(18));

        LinearLayout form = card();
        form.setPadding(dp(28), dp(26), dp(28), dp(26));

        FrameLayout emblem = new FrameLayout(this);
        emblem.setBackground(makeMaterialSurfaceDrawable(FOLDER_BG, 0, 16, 0));
        ImageView emblemIcon = new ImageView(this);
        emblemIcon.setImageResource(R.drawable.ic_admin_tv);
        emblemIcon.setColorFilter(ACCENT);
        emblem.addView(emblemIcon, new FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER));
        form.addView(emblem, new LinearLayout.LayoutParams(dp(48), dp(48)));
        addSpace(form, 16);

        form.addView(text("Вход в медиатеку", 22, Color.WHITE, true));
        addSpace(form, 18);

        EditText login = input("Логин", "");
        EditText password = input("Пароль", "");
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        form.addView(login, new LinearLayout.LayoutParams(-1, dp(48)));
        addSpace(form, 12);
        form.addView(password, new LinearLayout.LayoutParams(-1, dp(48)));
        addSpace(form, 16);
        TextView submit = actionButton("Войти", CARD_ELEVATED, TEXT);
        submit.setOnClickListener(v -> loginWithApi(login.getText().toString(), password.getText().toString()));
        form.addView(submit, new LinearLayout.LayoutParams(-1, dp(48)));
        addSpace(form, 10);
        TextView register = actionButton("Создать аккаунт", CARD_ELEVATED, TEXT);
        register.setOnClickListener(v -> registerWithApi(login.getText().toString(), password.getText().toString()));
        form.addView(register, new LinearLayout.LayoutParams(-1, dp(48)));

        int maxWidth = isTvLayout() ? dp(440) : -1;
        FrameLayout.LayoutParams formParams = new FrameLayout.LayoutParams(maxWidth, -2, Gravity.CENTER_HORIZONTAL);
        wrapper.addView(form, formParams);
        content.addView(wrapper);
    }

    private void renderSettingsPage() {
        LinearLayout preferences = card();
        preferences.setPadding(dp(20), dp(20), dp(20), dp(20));
        preferences.addView(text("Оформление и интерфейс", 16, Color.WHITE, true));
        addSpace(preferences, 4);
        preferences.addView(text("Современная тёмная тема Video Vault", 13, MUTED, false));
        addSpace(preferences, 14);

        TextView defaultView = actionButton(
            "grid".equals(viewMode) ? "Вид списка · Плитка" : "Вид списка · Список",
            CARD_ELEVATED,
            TEXT
        );
        defaultView.setOnClickListener(v -> {
            viewMode = "grid".equals(viewMode) ? "list" : "grid";
            getPreferences(MODE_PRIVATE).edit().putString("viewMode", viewMode).apply();
            render();
        });
        preferences.addView(defaultView, new LinearLayout.LayoutParams(-1, dp(46)));

        addSpace(preferences, 8);
        TextView sortPref = actionButton("Сортировка · " + sortButtonLabel(), CARD_ELEVATED, TEXT);
        sortPref.setOnClickListener(v -> showSortDialog());
        preferences.addView(sortPref, new LinearLayout.LayoutParams(-1, dp(46)));

        addSpace(preferences, 8);
        TextView refreshBtn = actionButton("Обновить медиатеку", CARD_ELEVATED, TEXT);
        refreshBtn.setOnClickListener(v -> refreshData());
        preferences.addView(refreshBtn, new LinearLayout.LayoutParams(-1, dp(46)));

        content.addView(withBottomMargin(preferences, 12));
        renderAccountPage();
    }

    private void renderAccountPage() {
        LinearLayout account = card();
        account.setPadding(dp(20), dp(20), dp(20), dp(20));
        account.addView(text("Аккаунт", 13, MUTED, false));
        addSpace(account, 4);
        account.addView(text(accountLogin.isEmpty() ? "Гость" : accountLogin, 18, Color.WHITE, true));
        addSpace(account, 14);
        TextView logout = actionButton("Выйти из аккаунта", CARD_ELEVATED, TEXT);
        logout.setOnClickListener(v -> logout());
        account.addView(logout, new LinearLayout.LayoutParams(-1, dp(46)));
        content.addView(account);
    }

    private void logout() {
        page = "videos";
        accountLogin = "";
        isAdmin = false;
        apiClient.setAuthToken("");
        repository.replaceData(Collections.emptyList(), Collections.emptyList());
        refreshData();
    }

    private void registerWithApi(String login, String password) {
        if (isLoading) return;
        isLoading = true;
        new Thread(() -> {
            try {
                JSONObject payload = new JSONObject().put("login", login.trim()).put("password", password);
                apiClient.postJson("/auth/register", payload);
                runOnUiThread(() -> {
                    isLoading = false;
                    toastDialog("Регистрация", "Заявка отправлена администратору.");
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    isLoading = false;
                    toastDialog("Ошибка регистрации", safeText(error.getMessage()));
                });
            }
        }).start();
    }

    private View adminFolderCard(SharedFolder folder) {
        LinearLayout card = card();
        card.setPadding(dp(18), dp(16), dp(18), dp(16));
        card.addView(text(folder.name, isTvLandscape() ? 15 : 17, Color.WHITE, true));
        card.addView(text(folder.path, isTvLandscape() ? 11 : 12, MUTED, false));
        card.addView(text(folder.filesCount + " файлов • " + folder.lastScanAt, 12, MUTED, false));
        addSpace(card, 12);

        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setClipChildren(false);
        row.setClipToPadding(false);
        row.addView(pill(folder.enabled ? "ON" : "OFF", false));
        TextView delete = actionButton("Удалить путь", Color.rgb(52, 30, 35), Color.rgb(255, 185, 185));
        delete.setOnClickListener(v -> confirmDelete(folder));
        row.addView(delete, new LinearLayout.LayoutParams(0, dp(44), 1));
        card.addView(row);
        addSpace(card, 8);
        TextView manage = actionButton("Настроить папку", CARD_ELEVATED, TEXT);
        manage.setOnClickListener(v -> new MaterialAlertDialogBuilder(this).setTitle(folder.name)
            .setItems(new String[]{"Переименовать", folder.enabled ? "Скрыть папку" : "Показать папку", "Пересканировать"},
                (dialog, choice) -> {
                    if (choice == 0) {
                        EditText name = input("Название папки", folder.name);
                        new MaterialAlertDialogBuilder(this).setTitle("Название папки").setView(name)
                            .setNegativeButton("Отмена", null)
                            .setPositiveButton("Сохранить", (edit, button) ->
                                updateFolder(folder, name.getText().toString().trim(), false))
                            .show();
                    } else {
                        updateFolder(folder, null, choice == 2);
                    }
                }).show());
        card.addView(manage, new LinearLayout.LayoutParams(-1, dp(44)));
        return withBottomMargin(card, 12);
    }

    private void updateFolder(SharedFolder folder, String name, boolean rescan) {
        if (name != null && name.isEmpty()) {
            toastDialog("Название папки", "Введите название.");
            return;
        }
        new Thread(() -> {
            try {
                String route = "/folders/" + Uri.encode(folder.id);
                if (rescan) apiClient.get(route + "/rescan");
                else {
                    JSONObject patch = new JSONObject();
                    if (name == null) patch.put("enabled", !folder.enabled);
                    else patch.put("name", name);
                    apiClient.sendJson("PATCH", route, patch);
                }
                runOnUiThread(() -> {
                    refreshData();
                    if (rescan) android.widget.Toast.makeText(this, "Сканирование запущено", android.widget.Toast.LENGTH_SHORT).show();
                });
            } catch (Exception error) {
                runOnUiThread(() -> toastDialog("Ошибка папки", safeText(error.getMessage())));
            }
        }).start();
    }

    private void confirmDelete(SharedFolder folder) {
        new MaterialAlertDialogBuilder(this)
            .setTitle("Удалить путь?")
            .setMessage(folder.path + "\n\nФайлы на диске не удалятся.")
            .setNegativeButton("Отмена", null)
            .setPositiveButton("Удалить", (dialog, which) -> deleteFolder(folder))
            .show();
    }

    private void loginWithApi(String login, String password) {
        if (isLoading) return;
        isLoading = true;
        loadError = "";
        render();
        new Thread(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("login", login);
                payload.put("password", password);
                JSONObject response = apiClient.postJson("/auth/login", payload);
                String token = response.optString("token", "");
                if (token.isEmpty()) throw new IllegalStateException("Сервер не вернул токен.");
                apiClient.setAuthToken(token);
                runOnUiThread(() -> {
                    accountLogin = response.optString("login", login);
                    isAdmin = "admin".equals(response.optString("role"));
                    if ("login".equals(page)) page = loginReturnPage;
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
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        playerSpeed = 1.0f;
        playerRepeatMode = Player.REPEAT_MODE_OFF;
        sleepTimerEndAtMs = 0L;
        playerStatsVisible = false;
        tvHudVisible = false;
        tvQueueOpen = false;
        tvUpNextVisible = false;
        tvUpNextTargetIndex = -1;
        quickSeekAccumulatedMs = 0L;
        quickSeekDirection = 0;
        scrubAccumulatedMs = 0L;

        playerView = new PlayerView(this);
        playerView.setKeepContentOnPlayerReset(true);
        playerView.setResizeMode(playerResizeMode);
        playerView.setFocusable(true);
        playerView.setFocusableInTouchMode(isTvLayout());

        if (isTvLayout()) {
            playerView.setUseController(false);
            playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER);
            renderTvPlayerStage();
        } else {
            playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);
            playerView.setUseController(true);
            playerView.setControllerShowTimeoutMs(5000);
            configurePlayerControls(playerView);
            seekFeedbackView = null;
            LinearLayout header = new LinearLayout(this);
            header.setGravity(Gravity.CENTER_VERTICAL);
            header.setClipChildren(false);
            header.setClipToPadding(false);
            header.setPadding(dp(12), dp(14), dp(12), dp(10));

            TextView back = pill("Назад", false);
            applyFocus(back, CARD_ELEVATED, ACCENT, 999, 0);
            back.setOnClickListener(v -> closePlayer());
            header.addView(back);

            LinearLayout titleBox = new LinearLayout(this);
            titleBox.setOrientation(LinearLayout.VERTICAL);
            titleBox.setPadding(dp(12), 0, dp(8), 0);
            titleBox.addView(text(selectedVideo.title, 19, Color.WHITE, true));
            titleBox.addView(text(selectedVideo.path, 12, MUTED, false));
            header.addView(titleBox, new LinearLayout.LayoutParams(0, -2, 1));

            if (!getCastTargetDevices().isEmpty()) {
                FrameLayout castBtn = buildTvCircleIconButton(R.drawable.ic_cast_tv, 40, 20, "Отправить на ТВ");
                castBtn.setOnClickListener(v -> showCastVideoPicker(selectedVideo, "replace"));
                header.addView(castBtn, new LinearLayout.LayoutParams(dp(40), dp(40)));
            }
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
        activeMediaDataSourceFactory = dataSourceFactory;
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(12000, 50000, 1500, 3000)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build();
        DefaultMediaSourceFactory directSources = new DefaultMediaSourceFactory(dataSourceFactory);
        activeDirectMediaSourceFactory = directSources;
        player = new ExoPlayer.Builder(this)
            .setLoadControl(loadControl)
            .setMediaSourceFactory(directSources)
            .build();
        player.setSeekParameters(androidx.media3.exoplayer.SeekParameters.EXACT);
        player.setRepeatMode(playerRepeatMode);
        player.setPauseAtEndOfMediaItems(isTvLayout() && playerRepeatMode != Player.REPEAT_MODE_ONE);
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
                if (!selectedVideo.id.equals(locallyStartedVideoId)) {
                    locallyStartedVideoId = "";
                }
                dismissUpNextOverlay(false);
                updatePlayerMetadata();
                if (isTvLayout()) {
                    rebuildTvQueueCards();
                    updateTvControlStates();
                    updateTvPlayerProgressUi();
                    reportTvPlayNow(selectedVideo, player.isPlaying() ? "playing" : "paused", true);
                }
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isTvLayout()) {
                    updateTvPlayPauseIcon();
                    reportTvPlayNow(selectedVideo, isPlaying ? "playing" : "paused", false);
                    if (isPlaying) {
                        dismissUpNextOverlay(false);
                        if (tvHudVisible) {
                            schedulePlayerControlsHide();
                        }
                    } else {
                        saveCurrentVideoProgress(true);
                        cancelPlayerControlsHide();
                    }
                }
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (!isTvLayout()) {
                    return;
                }
                if (tvBufferingSpinner != null) {
                    tvBufferingSpinner.setVisibility(
                        playbackState == Player.STATE_BUFFERING ? View.VISIBLE : View.GONE
                    );
                }
                if (playbackState == Player.STATE_READY) {
                    updateTvPlayerProgressUi();
                } else if (playbackState == Player.STATE_ENDED) {
                    handleTvMediaItemFinished();
                }
            }

            @Override
            public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                if (isTvLayout()
                    && !playWhenReady
                    && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
                    handleTvMediaItemFinished();
                }
            }

            @Override
            public void onTracksChanged(Tracks tracks) {
                if (isTvLayout()) {
                    updateStatsOverlayText();
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                ExoPlayer failedPlayer = player;
                cancelPlayerControlsHide();
                new MaterialAlertDialogBuilder(MainActivity.this)
                    .setTitle("Не удалось воспроизвести видео")
                    .setMessage(error.getErrorCodeName())
                    .setNegativeButton("Закрыть", (d, w) -> closePlayer())
                    .setPositiveButton("Повторить", (dialog, which) -> {
                        if (player == failedPlayer && player != null) {
                            player.prepare();
                            player.play();
                        }
                    })
                    .show();
            }
        });

        if (playbackQueue.isEmpty()) {
            playbackQueue.add(selectedVideo);
            playbackIndex = 0;
        }
        List<MediaSource> sources = new ArrayList<>();
        for (VideoFile video : playbackQueue) {
            if (video.usesHls()) {
                String url = apiClient.absoluteUrl("/videos/" + Uri.encode(video.id) + "/hls/master.m3u8");
                MediaItem item = new MediaItem.Builder().setMediaId(video.id)
                    .setUri(url).setMimeType(MimeTypes.APPLICATION_M3U8).build();
                sources.add(new HlsMediaSource.Factory(dataSourceFactory)
                    .setPlaylistParserFactory(new VaultHlsPlaylistParser(apiClient, video.id))
                    .createMediaSource(item));
            } else {
                sources.add(directSources.createMediaSource(new MediaItem.Builder()
                    .setMediaId(video.id).setUri(video.streamUrl).build()));
            }
        }

        long resumePosMs = selectedVideo == null ? 0L : getSavedVideoPosition(selectedVideo.id);
        player.setMediaSources(sources, Math.max(0, playbackIndex), resumePosMs);
        player.prepare();
        player.play();

        if (isTvLayout()) {
            updatePlayerMetadata();
            updateTvControlStates();
            rebuildTvQueueCards();
            updateTvPlayerProgressUi();
            setTvHudVisible(true, tvPlayPauseButton);
            playerView.postDelayed(playerTickRunnable, 350L);
            reportTvPlayNow(selectedVideo, "playing", true);
            if (resumePosMs > 0L) {
                showCenterAction(R.drawable.ic_play_tv, "Продолжено с " + TvSeekBar.formatTime(resumePosMs));
            }
        }
    }

    private void renderTvPlayerStage() {
        FrameLayout playerStage = new FrameLayout(this);
        playerStage.setBackgroundColor(Color.BLACK);
        playerStage.setClipChildren(false);
        playerStage.setClipToPadding(false);

        playerView.setOnClickListener(v -> {
            if (tvHudVisible) {
                setTvHudVisible(false, null);
            } else {
                setTvHudVisible(true, tvPlayPauseButton);
            }
        });
        playerStage.addView(playerView, new FrameLayout.LayoutParams(-1, -1));

        // Layer 1: Centered amber buffering spinner
        tvBufferingSpinner = new ProgressBar(this);
        tvBufferingSpinner.setIndeterminate(true);
        if (tvBufferingSpinner.getIndeterminateDrawable() != null) {
            tvBufferingSpinner.getIndeterminateDrawable().setTint(ACCENT);
        }
        tvBufferingSpinner.setVisibility(View.VISIBLE);
        playerStage.addView(tvBufferingSpinner, new FrameLayout.LayoutParams(dp(54), dp(54), Gravity.CENTER));

        // Layer 2: YouTube-style left & right ±10s seek indicators + center pulse + slim mini-progress
        tvSeekLeftOverlay = buildSideSeekOverlay(R.drawable.ic_replay_10_tv);
        tvSeekLeftLabel = (TextView) tvSeekLeftOverlay.getTag();
        FrameLayout.LayoutParams leftSeekParams = new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER_VERTICAL | Gravity.LEFT);
        leftSeekParams.leftMargin = dp(64);
        playerStage.addView(tvSeekLeftOverlay, leftSeekParams);

        tvSeekRightOverlay = buildSideSeekOverlay(R.drawable.ic_forward_10_tv);
        tvSeekRightLabel = (TextView) tvSeekRightOverlay.getTag();
        FrameLayout.LayoutParams rightSeekParams = new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER_VERTICAL | Gravity.RIGHT);
        rightSeekParams.rightMargin = dp(64);
        playerStage.addView(tvSeekRightOverlay, rightSeekParams);

        tvCenterActionOverlay = new LinearLayout(this);
        tvCenterActionOverlay.setOrientation(LinearLayout.VERTICAL);
        tvCenterActionOverlay.setGravity(Gravity.CENTER);
        tvCenterActionOverlay.setPadding(dp(24), dp(18), dp(24), dp(18));
        tvCenterActionOverlay.setBackground(makeMaterialSurfaceDrawable(Color.argb(215, 15, 16, 20), 0, 24, 0));
        tvCenterActionOverlay.setVisibility(View.GONE);
        tvCenterActionIcon = new ImageView(this);
        tvCenterActionIcon.setColorFilter(ACCENT);
        tvCenterActionIcon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        tvCenterActionOverlay.addView(tvCenterActionIcon, new LinearLayout.LayoutParams(dp(38), dp(38)));
        tvCenterActionLabel = text("", 14, Color.WHITE, true);
        tvCenterActionLabel.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams centerLabelParams = new LinearLayout.LayoutParams(-2, -2);
        centerLabelParams.topMargin = dp(8);
        tvCenterActionOverlay.addView(tvCenterActionLabel, centerLabelParams);
        playerStage.addView(tvCenterActionOverlay, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));

        // Slim bottom mini-progress shown when quick-seeking while HUD is hidden
        tvMiniProgressContainer = new LinearLayout(this);
        tvMiniProgressContainer.setOrientation(LinearLayout.VERTICAL);
        tvMiniProgressContainer.setPadding(dp(44), dp(24), dp(44), dp(22));
        tvMiniProgressContainer.setBackground(new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{Color.TRANSPARENT, Color.argb(215, 8, 9, 12)}
        ));
        tvMiniProgressContainer.setVisibility(View.GONE);
        tvMiniTimeLabel = text("0:00 / 0:00", 14, Color.WHITE, true);
        tvMiniProgressContainer.addView(tvMiniTimeLabel);
        tvMiniSeekBar = new TvSeekBar(this);
        tvMiniSeekBar.setFocusable(false);
        tvMiniSeekBar.setFocusableInTouchMode(false);
        tvMiniSeekBar.setClickable(false);
        tvMiniProgressContainer.addView(tvMiniSeekBar, new LinearLayout.LayoutParams(-1, dp(34)));
        playerStage.addView(tvMiniProgressContainer, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));

        // Layer 3: Full YouTube TV HUD Overlay (Top gradient scrim + Bottom gradient scrim)
        tvPlayerHud = new FrameLayout(this);
        tvPlayerHud.setClipChildren(false);
        tvPlayerHud.setClipToPadding(false);
        tvPlayerHud.setVisibility(View.GONE);

        // Top Gradient Scrim & Header Info Bar
        LinearLayout topScrim = new LinearLayout(this);
        topScrim.setOrientation(LinearLayout.HORIZONTAL);
        topScrim.setGravity(Gravity.TOP);
        topScrim.setClipChildren(false);
        topScrim.setClipToPadding(false);
        topScrim.setPadding(dp(44), dp(30), dp(44), dp(52));
        topScrim.setBackground(new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{Color.argb(220, 8, 9, 12), Color.argb(120, 8, 9, 12), Color.TRANSPARENT}
        ));

        FrameLayout backBtn = buildTvCircleIconButton(R.drawable.ic_arrow_back_tv, 46, 22, "Назад");
        tvBackButton = backBtn;
        backBtn.setOnClickListener(v -> closePlayer());
        topScrim.addView(backBtn, new LinearLayout.LayoutParams(dp(46), dp(46)));

        LinearLayout titleCol = new LinearLayout(this);
        titleCol.setOrientation(LinearLayout.VERTICAL);
        titleCol.setPadding(dp(18), dp(2), dp(24), 0);
        playerTitleView = text(selectedVideo == null ? "" : selectedVideo.title, 23, Color.WHITE, true);
        playerTitleView.setMaxLines(1);
        playerTitleView.setEllipsize(TextUtils.TruncateAt.END);
        playerSubtitleView = text("", 13, Color.argb(210, 220, 224, 232), false);
        playerSubtitleView.setMaxLines(1);
        playerSubtitleView.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams subParams = new LinearLayout.LayoutParams(-1, -2);
        subParams.topMargin = dp(4);
        titleCol.addView(playerTitleView);
        titleCol.addView(playerSubtitleView, subParams);
        topScrim.addView(titleCol, new LinearLayout.LayoutParams(0, -2, 1));

        LinearLayout rightInfoCol = new LinearLayout(this);
        rightInfoCol.setOrientation(LinearLayout.VERTICAL);
        rightInfoCol.setGravity(Gravity.END);
        LinearLayout clockAndBadges = new LinearLayout(this);
        clockAndBadges.setOrientation(LinearLayout.HORIZONTAL);
        clockAndBadges.setGravity(Gravity.CENTER_VERTICAL);
        tvStatusBadgesRow = new LinearLayout(this);
        tvStatusBadgesRow.setOrientation(LinearLayout.HORIZONTAL);
        tvStatusBadgesRow.setGravity(Gravity.CENTER_VERTICAL);
        clockAndBadges.addView(tvStatusBadgesRow);
        tvClockView = text("", 19, Color.WHITE, true);
        tvClockView.setPadding(dp(12), 0, 0, 0);
        clockAndBadges.addView(tvClockView);
        rightInfoCol.addView(clockAndBadges);

        tvFinishTimeView = text("", 12, Color.argb(195, 200, 206, 216), false);
        LinearLayout.LayoutParams finishParams = new LinearLayout.LayoutParams(-2, -2);
        finishParams.topMargin = dp(3);
        rightInfoCol.addView(tvFinishTimeView, finishParams);
        topScrim.addView(rightInfoCol, new LinearLayout.LayoutParams(-2, -2));

        tvPlayerHud.addView(topScrim, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));

        // Bottom Gradient Scrim: Time labels + Custom YouTube TvSeekBar + Controls Row + Up Next Strip
        LinearLayout bottomScrim = new LinearLayout(this);
        bottomScrim.setOrientation(LinearLayout.VERTICAL);
        bottomScrim.setClipChildren(false);
        bottomScrim.setClipToPadding(false);
        bottomScrim.setPadding(dp(44), dp(64), dp(44), dp(26));
        bottomScrim.setBackground(new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{Color.TRANSPARENT, Color.argb(145, 8, 9, 12), Color.argb(240, 8, 9, 12)}
        ));

        // Time Row
        LinearLayout timeRow = new LinearLayout(this);
        timeRow.setGravity(Gravity.CENTER_VERTICAL);
        timeRow.setPadding(dp(12), 0, dp(12), 0);
        tvCurrentTimeView = text("0:00", 14, Color.WHITE, true);
        timeRow.addView(tvCurrentTimeView);
        timeRow.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1));
        tvTotalTimeView = text("0:00", 14, Color.argb(210, 210, 214, 222), true);
        timeRow.addView(tvTotalTimeView);
        bottomScrim.addView(timeRow);

        // Custom YouTube TV Seek Bar with floating timestamp bubble
        tvSeekBar = new TvSeekBar(this);
        tvSeekBar.setId(View.generateViewId());
        tvSeekBar.setContentDescription("Полоса перемотки");
        tvSeekBar.setOnFocusChangeListener((v, hasFocus) -> {
            tvSeekBar.animateFocusState(hasFocus);
            if (hasFocus) {
                allowFocusOverflow(tvSeekBar, null);
                schedulePlayerControlsHide();
            } else {
                tvSeekBar.setScrubPreview(false, player == null ? 0L : player.getCurrentPosition(), "");
            }
        });
        tvSeekBar.setOnSeekListener(targetMs -> {
            if (player != null) {
                player.seekTo(targetMs);
                updateTvPlayerProgressUi();
                schedulePlayerControlsHide();
            }
        });
        LinearLayout.LayoutParams seekParams = new LinearLayout.LayoutParams(-1, dp(56));
        seekParams.topMargin = -dp(12);
        bottomScrim.addView(tvSeekBar, seekParams);

        // Primary Controls Row (Transport on left, YouTube utility pills on right)
        LinearLayout controlsRow = new LinearLayout(this);
        controlsRow.setOrientation(LinearLayout.HORIZONTAL);
        controlsRow.setGravity(Gravity.CENTER_VERTICAL);
        controlsRow.setClipChildren(false);
        controlsRow.setClipToPadding(false);
        LinearLayout.LayoutParams controlsRowParams = new LinearLayout.LayoutParams(-1, -2);
        controlsRowParams.topMargin = dp(8);

        List<View> orderedControls = new ArrayList<>();

        FrameLayout prevBtn = buildTvCircleIconButton(R.drawable.ic_skip_prev_tv, 46, 22, "Предыдущее видео");
        tvPrevButton = prevBtn;
        prevBtn.setOnClickListener(v -> playPreviousOrRestart());
        controlsRow.addView(prevBtn, new LinearLayout.LayoutParams(dp(46), dp(46)));
        orderedControls.add(prevBtn);
        addInlineSpace(controlsRow, 10);

        FrameLayout rewindBtn = buildTvCircleIconButton(R.drawable.ic_replay_10_tv, 46, 24, "Назад 10 секунд");
        tvRewindButton = rewindBtn;
        rewindBtn.setOnClickListener(v -> triggerButtonSeek(-10_000L));
        controlsRow.addView(rewindBtn, new LinearLayout.LayoutParams(dp(46), dp(46)));
        orderedControls.add(rewindBtn);
        addInlineSpace(controlsRow, 12);

        tvPlayPauseButton = buildTvCircleIconButton(R.drawable.ic_pause_tv, 56, 28, "Воспроизведение и пауза");
        tvPlayPauseIcon = (ImageView) tvPlayPauseButton.getChildAt(0);
        tvPlayPauseButton.setOnClickListener(v -> togglePlayPauseFromRemote(false));
        controlsRow.addView(tvPlayPauseButton, new LinearLayout.LayoutParams(dp(56), dp(56)));
        orderedControls.add(tvPlayPauseButton);
        addInlineSpace(controlsRow, 12);

        FrameLayout forwardBtn = buildTvCircleIconButton(R.drawable.ic_forward_10_tv, 46, 24, "Вперёд 10 секунд");
        tvForwardButton = forwardBtn;
        forwardBtn.setOnClickListener(v -> triggerButtonSeek(10_000L));
        controlsRow.addView(forwardBtn, new LinearLayout.LayoutParams(dp(46), dp(46)));
        orderedControls.add(forwardBtn);
        addInlineSpace(controlsRow, 10);

        FrameLayout nextBtn = buildTvCircleIconButton(R.drawable.ic_skip_next_tv, 46, 22, "Следующее видео");
        tvNextButton = nextBtn;
        nextBtn.setOnClickListener(v -> playNextInQueue());
        controlsRow.addView(nextBtn, new LinearLayout.LayoutParams(dp(46), dp(46)));
        orderedControls.add(nextBtn);

        controlsRow.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1));

        // Right-side YouTube TV Utility Controls
        LinearLayout queueBtn = buildTvPillControl(R.drawable.ic_queue_tv, "Далее", "Очередь воспроизведения");
        tvQueueButton = queueBtn;
        queueBtn.setOnClickListener(v -> setTvQueueOpen(!tvQueueOpen, tvQueueOpen ? tvQueueButton : null));
        controlsRow.addView(queueBtn, new LinearLayout.LayoutParams(-2, dp(44)));
        orderedControls.add(queueBtn);
        addInlineSpace(controlsRow, 8);

        tvSpeedButton = buildTvTextPillControl("1x", "Скорость воспроизведения");
        tvSpeedButton.setOnClickListener(v -> showTvSpeedDialog());
        controlsRow.addView(tvSpeedButton, new LinearLayout.LayoutParams(-2, dp(44)));
        orderedControls.add(tvSpeedButton);
        addInlineSpace(controlsRow, 8);

        FrameLayout tracksBtn = buildTvCircleIconButton(R.drawable.ic_subtitles_tv, 44, 21, "Аудио, субтитры и качество");
        tvTracksButton = tracksBtn;
        tracksBtn.setOnClickListener(v -> showTvTracksMenuDialog());
        controlsRow.addView(tracksBtn, new LinearLayout.LayoutParams(dp(44), dp(44)));
        orderedControls.add(tracksBtn);
        addInlineSpace(controlsRow, 8);

        FrameLayout aspectBtn = buildTvCircleIconButton(R.drawable.ic_aspect_tv, 44, 21, "Масштаб экрана");
        tvAspectButton = aspectBtn;
        aspectBtn.setOnClickListener(v -> cycleTvAspectMode());
        controlsRow.addView(aspectBtn, new LinearLayout.LayoutParams(dp(44), dp(44)));
        orderedControls.add(aspectBtn);
        addInlineSpace(controlsRow, 8);

        tvRepeatButton = buildTvCircleIconButton(R.drawable.ic_repeat_tv, 44, 21, "Повтор");
        tvRepeatIcon = (ImageView) tvRepeatButton.getChildAt(0);
        tvRepeatButton.setOnClickListener(v -> cycleTvRepeatMode());
        controlsRow.addView(tvRepeatButton, new LinearLayout.LayoutParams(dp(44), dp(44)));
        orderedControls.add(tvRepeatButton);
        addInlineSpace(controlsRow, 8);

        LinearLayout autoBtn = buildTvPillControl(R.drawable.ic_autoplay_tv, "Авто", "Автовоспроизведение следующего видео");
        tvAutoplayButton = autoBtn;
        autoBtn.setOnClickListener(v -> toggleTvAutoplay());
        controlsRow.addView(autoBtn, new LinearLayout.LayoutParams(-2, dp(44)));
        orderedControls.add(autoBtn);
        addInlineSpace(controlsRow, 8);

        FrameLayout moreBtn = buildTvCircleIconButton(R.drawable.ic_more_vert_tv, 44, 21, "Ещё");
        tvMoreButton = moreBtn;
        moreBtn.setOnClickListener(v -> showTvMoreDialog());
        controlsRow.addView(moreBtn, new LinearLayout.LayoutParams(dp(44), dp(44)));
        orderedControls.add(moreBtn);

        // Deterministic D-Pad focus wiring for Back, SeekBar, and Controls Row
        backBtn.setNextFocusDownId(tvSeekBar.getId());
        backBtn.setNextFocusUpId(backBtn.getId());
        backBtn.setNextFocusLeftId(backBtn.getId());
        backBtn.setNextFocusRightId(backBtn.getId());

        tvSeekBar.setNextFocusUpId(backBtn.getId());
        tvSeekBar.setNextFocusDownId(tvPlayPauseButton.getId());

        for (int i = 0; i < orderedControls.size(); i++) {
            View ctrl = orderedControls.get(i);
            ctrl.setNextFocusUpId(tvSeekBar.getId());
            ctrl.setNextFocusLeftId(i > 0 ? orderedControls.get(i - 1).getId() : ctrl.getId());
            ctrl.setNextFocusRightId(i < orderedControls.size() - 1 ? orderedControls.get(i + 1).getId() : ctrl.getId());
        }

        bottomScrim.addView(controlsRow, controlsRowParams);

        // Collapsible YouTube TV "Далее в очереди" Thumbnail Shelf
        tvQueuePanel = new LinearLayout(this);
        tvQueuePanel.setOrientation(LinearLayout.VERTICAL);
        tvQueuePanel.setClipChildren(false);
        tvQueuePanel.setClipToPadding(false);
        tvQueuePanel.setVisibility(View.GONE);
        LinearLayout.LayoutParams queuePanelParams = new LinearLayout.LayoutParams(-1, -2);
        queuePanelParams.topMargin = dp(18);

        LinearLayout queueHeader = new LinearLayout(this);
        queueHeader.setGravity(Gravity.CENTER_VERTICAL);
        tvQueueHeading = text("Далее в очереди", 15, Color.WHITE, true);
        queueHeader.addView(tvQueueHeading);
        queueHeader.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1));
        queueHeader.addView(text("▲ Назад к управлению", 12, Color.argb(180, 200, 206, 216), false));
        tvQueuePanel.addView(queueHeader);

        tvQueueScroll = new HorizontalScrollView(this);
        tvQueueScroll.setHorizontalScrollBarEnabled(false);
        tvQueueScroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        tvQueueScroll.setClipChildren(false);
        tvQueueScroll.setClipToPadding(false);
        tvQueueScroll.setPadding(dp(4), dp(12), dp(4), dp(8));
        tvQueueScroll.setFocusable(false);
        tvQueueScroll.setFocusableInTouchMode(false);
        tvQueueRow = new LinearLayout(this);
        tvQueueRow.setOrientation(LinearLayout.HORIZONTAL);
        tvQueueRow.setClipChildren(false);
        tvQueueRow.setClipToPadding(false);
        tvQueueScroll.addView(tvQueueRow);
        tvQueuePanel.addView(tvQueueScroll, new LinearLayout.LayoutParams(-1, -2));

        bottomScrim.addView(tvQueuePanel, queuePanelParams);

        tvPlayerHud.addView(bottomScrim, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        playerStage.addView(tvPlayerHud, new FrameLayout.LayoutParams(-1, -1));

        // Layer 4: YouTube "Stats for Nerds" overlay panel (top-right below header)
        tvStatsOverlay = new LinearLayout(this);
        tvStatsOverlay.setOrientation(LinearLayout.VERTICAL);
        tvStatsOverlay.setPadding(dp(18), dp(14), dp(18), dp(14));
        tvStatsOverlay.setBackground(makeMaterialSurfaceDrawable(Color.argb(222, 15, 16, 20), 0, 16, 0));
        tvStatsOverlay.setVisibility(View.GONE);
        tvStatsOverlay.addView(text("Статистика для сисадминов", 13, ACCENT, true));
        addSpace(tvStatsOverlay, 6);
        tvStatsBody = text("", 12, Color.rgb(228, 232, 238), false);
        tvStatsBody.setLineSpacing(dp(3), 1f);
        tvStatsOverlay.addView(tvStatsBody);
        FrameLayout.LayoutParams statsParams = new FrameLayout.LayoutParams(dp(340), -2, Gravity.TOP | Gravity.RIGHT);
        statsParams.setMargins(0, dp(104), dp(44), 0);
        playerStage.addView(tvStatsOverlay, statsParams);

        // Layer 5: YouTube-style Up-Next Autoplay Countdown Card (bottom-right)
        tvUpNextOverlay = buildTvUpNextOverlay();
        FrameLayout.LayoutParams upNextParams = new FrameLayout.LayoutParams(dp(360), -2, Gravity.BOTTOM | Gravity.RIGHT);
        upNextParams.setMargins(0, 0, dp(44), dp(40));
        playerStage.addView(tvUpNextOverlay, upNextParams);

        root.addView(playerStage, new LinearLayout.LayoutParams(-1, -1));
    }

    private LinearLayout buildSideSeekOverlay(int iconRes) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(dp(22), dp(16), dp(22), dp(16));
        box.setBackground(makeMaterialSurfaceDrawable(Color.argb(215, 15, 16, 20), 0, 24, 0));
        box.setVisibility(View.GONE);
        ImageView icon = new ImageView(this);
        icon.setImageResource(iconRes);
        icon.setColorFilter(ACCENT);
        icon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        box.addView(icon, new LinearLayout.LayoutParams(dp(34), dp(34)));
        TextView label = text("10 сек", 15, Color.WHITE, true);
        label.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.topMargin = dp(6);
        box.addView(label, lp);
        box.setTag(label);
        return box;
    }

    private FrameLayout buildTvCircleIconButton(int iconRes, int sizeDp, int iconDp, String description) {
        FrameLayout button = new FrameLayout(this);
        button.setId(View.generateViewId());
        button.setFocusable(true);
        button.setFocusableInTouchMode(true);
        button.setClickable(true);
        button.setContentDescription(description);
        button.setTag(Boolean.FALSE); // active state flag

        ImageView icon = new ImageView(this);
        icon.setImageResource(iconRes);
        icon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        button.addView(icon, new FrameLayout.LayoutParams(dp(iconDp), dp(iconDp), Gravity.CENTER));

        styleTvPlayerControl(button, false);
        button.setOnFocusChangeListener((v, hasFocus) -> {
            if (hasFocus) {
                allowFocusOverflow(v, null);
                schedulePlayerControlsHide();
            }
            styleTvPlayerControl(v, hasFocus);
        });
        return button;
    }

    private LinearLayout buildTvPillControl(int iconRes, String label, String description) {
        LinearLayout button = new LinearLayout(this);
        button.setId(View.generateViewId());
        button.setOrientation(LinearLayout.HORIZONTAL);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(15), 0, dp(16), 0);
        button.setFocusable(true);
        button.setFocusableInTouchMode(true);
        button.setClickable(true);
        button.setContentDescription(description);
        button.setTag(Boolean.FALSE);

        ImageView icon = new ImageView(this);
        icon.setImageResource(iconRes);
        icon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        button.addView(icon, new LinearLayout.LayoutParams(dp(19), dp(19)));

        TextView textView = text(label, 13, Color.WHITE, true);
        textView.setPadding(dp(8), 0, 0, 0);
        button.addView(textView);

        styleTvPlayerControl(button, false);
        button.setOnFocusChangeListener((v, hasFocus) -> {
            if (hasFocus) {
                allowFocusOverflow(v, null);
                schedulePlayerControlsHide();
            }
            styleTvPlayerControl(v, hasFocus);
        });
        return button;
    }

    private TextView buildTvTextPillControl(String label, String description) {
        TextView button = text(label, 13, Color.WHITE, true);
        button.setId(View.generateViewId());
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(16), 0, dp(16), 0);
        button.setFocusable(true);
        button.setFocusableInTouchMode(true);
        button.setClickable(true);
        button.setContentDescription(description);
        button.setTag(Boolean.FALSE);

        styleTvPlayerControl(button, false);
        button.setOnFocusChangeListener((v, hasFocus) -> {
            if (hasFocus) {
                allowFocusOverflow(v, null);
                schedulePlayerControlsHide();
            }
            styleTvPlayerControl(v, hasFocus);
        });
        return button;
    }

    private void styleTvPlayerControl(View control, boolean hasFocus) {
        if (control == null) {
            return;
        }
        boolean active = Boolean.TRUE.equals(control.getTag());
        int bg = hasFocus
            ? ACCENT
            : (active ? ACCENT_SOFT : Color.argb(210, 28, 30, 38));
        int fg = hasFocus
            ? DARK
            : (active ? ACCENT : Color.WHITE);

        control.animate().cancel();
        control.animate()
            .scaleX(hasFocus ? 1.07f : 1f)
            .scaleY(hasFocus ? 1.07f : 1f)
            .setDuration(hasFocus ? 120L : 90L)
            .start();
        control.setElevation(hasFocus ? dp(14) : dp(2));
        control.setBackground(makeMaterialSurfaceDrawable(bg, 0, 999, 0));

        if (control instanceof TextView) {
            ((TextView) control).setTextColor(fg);
        } else if (control instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) control;
            for (int i = 0; i < group.getChildCount(); i++) {
                View child = group.getChildAt(i);
                if (child instanceof ImageView) {
                    ((ImageView) child).setColorFilter(fg);
                } else if (child instanceof TextView) {
                    ((TextView) child).setTextColor(fg);
                }
            }
        }
    }

    private LinearLayout buildTvUpNextOverlay() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(16), dp(18), dp(16));
        card.setBackground(makeMaterialSurfaceDrawable(Color.argb(242, 23, 25, 32), 0, 22, 0));
        card.setElevation(dp(20));
        card.setClipChildren(false);
        card.setClipToPadding(false);
        card.setVisibility(View.GONE);

        tvUpNextCountdownLabel = text("ДАЛЕЕ ЧЕРЕЗ 5 СЕК", 12, ACCENT, true);
        card.addView(tvUpNextCountdownLabel);
        addSpace(card, 10);

        FrameLayout posterWrap = new SixteenNineFrameLayout(this);
        posterWrap.setBackground(makeMaterialSurfaceDrawable(POSTER_BG, 0, 14, 0));
        posterWrap.setClipToOutline(true);
        tvUpNextPosterView = new ImageView(this);
        tvUpNextPosterView.setScaleType(ImageView.ScaleType.CENTER_CROP);
        posterWrap.addView(tvUpNextPosterView, new FrameLayout.LayoutParams(-1, -1));

        tvUpNextDurationView = text("", 11, Color.WHITE, true);
        tvUpNextDurationView.setPadding(dp(8), dp(3), dp(8), dp(3));
        tvUpNextDurationView.setBackground(makeMaterialSurfaceDrawable(Color.argb(210, 10, 11, 14), 0, 8, 0));
        FrameLayout.LayoutParams durParams = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.RIGHT);
        durParams.setMargins(0, 0, dp(8), dp(8));
        posterWrap.addView(tvUpNextDurationView, durParams);
        card.addView(posterWrap, new LinearLayout.LayoutParams(-1, -2));

        addSpace(card, 10);
        tvUpNextTitleView = text("", 15, Color.WHITE, true);
        tvUpNextTitleView.setMaxLines(2);
        tvUpNextTitleView.setEllipsize(TextUtils.TruncateAt.END);
        card.addView(tvUpNextTitleView);

        addSpace(card, 14);
        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setClipChildren(false);
        btnRow.setClipToPadding(false);

        tvUpNextPlayNowBtn = text("Смотреть сейчас", 13, TEXT, true);
        tvUpNextPlayNowBtn.setId(View.generateViewId());
        tvUpNextPlayNowBtn.setGravity(Gravity.CENTER);
        tvUpNextPlayNowBtn.setBackground(makeMaterialSurfaceDrawable(CARD_ELEVATED, 0, 999, 0));
        applyFocus(tvUpNextPlayNowBtn, CARD_ELEVATED, ACCENT, 999, 0);
        tvUpNextPlayNowBtn.setOnClickListener(v -> playUpNextTarget());
        btnRow.addView(tvUpNextPlayNowBtn, new LinearLayout.LayoutParams(0, dp(42), 1.3f));

        addInlineSpace(btnRow, 10);

        tvUpNextCancelBtn = text("Отмена", 13, TEXT, true);
        tvUpNextCancelBtn.setId(View.generateViewId());
        tvUpNextCancelBtn.setGravity(Gravity.CENTER);
        tvUpNextCancelBtn.setBackground(makeMaterialSurfaceDrawable(CARD_ELEVATED, 0, 999, 0));
        applyFocus(tvUpNextCancelBtn, CARD_ELEVATED, ACCENT, 999, 0);
        tvUpNextCancelBtn.setOnClickListener(v -> dismissUpNextOverlay(true));
        btnRow.addView(tvUpNextCancelBtn, new LinearLayout.LayoutParams(0, dp(42), 1f));

        tvUpNextPlayNowBtn.setNextFocusRightId(tvUpNextCancelBtn.getId());
        tvUpNextPlayNowBtn.setNextFocusLeftId(tvUpNextPlayNowBtn.getId());
        tvUpNextCancelBtn.setNextFocusLeftId(tvUpNextPlayNowBtn.getId());
        tvUpNextCancelBtn.setNextFocusRightId(tvUpNextCancelBtn.getId());

        card.addView(btnRow);
        return card;
    }

    private void rebuildTvQueueCards() {
        if (tvQueueRow == null) {
            return;
        }
        tvQueueRow.removeAllViews();
        if (tvQueueHeading != null) {
            tvQueueHeading.setText("Далее в очереди  ·  " + (playbackIndex + 1) + " / " + playbackQueue.size());
        }

        int cardWidth = dp(192);
        View prevCard = null;
        for (int i = 0; i < playbackQueue.size(); i++) {
            final int targetIdx = i;
            VideoFile video = playbackQueue.get(i);
            boolean isCurrent = i == playbackIndex;

            LinearLayout item = mediaCard();
            item.setId(View.generateViewId());
            item.setTag(i);

            FrameLayout poster = new SixteenNineFrameLayout(this);
            poster.setBackground(makeMaterialSurfaceDrawable(POSTER_BG, 0, 14, 0));
            poster.setClipToOutline(true);

            ImageView img = new ImageView(this);
            img.setScaleType(ImageView.ScaleType.CENTER_CROP);
            img.setAlpha(0f);
            poster.addView(img, new FrameLayout.LayoutParams(-1, -1));
            loadPosterInto(img, video);

            if (isCurrent) {
                TextView nowBadge = text("СЕЙЧАС", 10, DARK, true);
                nowBadge.setPadding(dp(8), dp(2), dp(8), dp(2));
                nowBadge.setBackground(makeMaterialSurfaceDrawable(ACCENT, 0, 6, 0));
                FrameLayout.LayoutParams nowParams = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.LEFT);
                nowParams.setMargins(dp(8), dp(8), 0, 0);
                poster.addView(nowBadge, nowParams);
            }

            if (video.duration != null && !video.duration.trim().isEmpty()) {
                TextView dur = text(video.duration, 10, Color.WHITE, true);
                dur.setPadding(dp(7), dp(2), dp(7), dp(2));
                dur.setBackground(makeMaterialSurfaceDrawable(Color.argb(210, 10, 11, 14), 0, 6, 0));
                FrameLayout.LayoutParams durParams = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.RIGHT);
                durParams.setMargins(0, 0, dp(8), dp(8));
                poster.addView(dur, durParams);
            }

            float watched = getSavedVideoProgressFraction(video.id);
            if (watched > 0.02f) {
                addThumbnailProgressBar(poster, watched);
            }

            View focusRing = new View(this);
            focusRing.setBackground(makeMaterialSurfaceDrawable(Color.TRANSPARENT, ACCENT, 14, 3));
            focusRing.setAlpha(0f);
            poster.addView(focusRing, new FrameLayout.LayoutParams(-1, -1));

            item.addView(poster, new LinearLayout.LayoutParams(-1, -2));

            TextView title = text((i + 1) + ". " + video.title, 12, isCurrent ? ACCENT_LIGHT : TEXT, true);
            title.setMaxLines(1);
            title.setEllipsize(TextUtils.TruncateAt.END);
            title.setPadding(dp(3), dp(7), dp(3), dp(2));
            item.addView(title);

            applyMediaCardFocus(item, poster, title, null, focusRing);
            item.setOnClickListener(v -> {
                if (player != null) {
                    saveCurrentVideoProgress(true);
                    long saved = getSavedVideoPosition(video.id);
                    player.seekTo(targetIdx, saved);
                    player.play();
                    setTvQueueOpen(false, tvPlayPauseButton);
                    schedulePlayerControlsHide();
                }
            });

            if (prevCard != null) {
                prevCard.setNextFocusRightId(item.getId());
                item.setNextFocusLeftId(prevCard.getId());
            } else {
                item.setNextFocusLeftId(item.getId());
            }
            if (tvPlayPauseButton != null) {
                item.setNextFocusUpId(tvPlayPauseButton.getId());
            }
            item.setNextFocusDownId(item.getId());
            prevCard = item;

            LinearLayout.LayoutParams itemParams = new LinearLayout.LayoutParams(cardWidth, -2);
            itemParams.setMargins(0, 0, dp(14), 0);
            tvQueueRow.addView(item, itemParams);
        }
        if (prevCard != null) {
            prevCard.setNextFocusRightId(prevCard.getId());
        }
    }

    private void setTvHudVisible(boolean visible, View focusTarget) {
        if (tvPlayerHud == null) {
            return;
        }
        tvHudVisible = visible;
        tvPlayerHud.animate().cancel();
        if (visible) {
            fadeOutOverlay(tvMiniProgressContainer);
            updateTvPlayerProgressUi();
            updateTvControlStates();
            tvPlayerHud.setVisibility(View.VISIBLE);
            tvPlayerHud.setAlpha(tvPlayerHud.getAlpha() < 0.99f ? 0f : 1f);
            tvPlayerHud.animate().alpha(1f).setDuration(150L).start();
            final View target = focusTarget != null ? focusTarget : tvPlayPauseButton;
            if (target != null) {
                tvPlayerHud.post(() -> {
                    if (tvHudVisible && target.isShown()) {
                        target.requestFocus();
                    }
                });
            }
            schedulePlayerControlsHide();
        } else {
            cancelPlayerControlsHide();
            if (tvQueueOpen) {
                tvQueueOpen = false;
                if (tvQueuePanel != null) tvQueuePanel.setVisibility(View.GONE);
                updateTvControlStates();
            }
            if (playerView != null) {
                playerView.requestFocus();
            }
            tvPlayerHud.animate()
                .alpha(0f)
                .setDuration(150L)
                .withEndAction(() -> {
                    if (!tvHudVisible && tvPlayerHud != null) {
                        tvPlayerHud.setVisibility(View.GONE);
                    }
                })
                .start();
        }
    }

    private void setTvQueueOpen(boolean open, View returnFocus) {
        if (tvQueuePanel == null || playbackQueue.isEmpty()) {
            return;
        }
        tvQueueOpen = open;
        updateTvControlStates();
        if (open) {
            cancelPlayerControlsHide();
            rebuildTvQueueCards();
            tvQueuePanel.setVisibility(View.VISIBLE);
            tvQueuePanel.setAlpha(0f);
            tvQueuePanel.animate().alpha(1f).setDuration(150L).start();
            tvQueuePanel.post(() -> {
                if (tvQueueRow == null || tvQueueRow.getChildCount() == 0) return;
                int focusIdx = Math.min(playbackIndex + 1, tvQueueRow.getChildCount() - 1);
                if (focusIdx < 0) focusIdx = 0;
                View targetCard = tvQueueRow.getChildAt(focusIdx);
                if (targetCard != null) {
                    targetCard.requestFocus();
                    if (tvQueueScroll != null) {
                        tvQueueScroll.smoothScrollTo(Math.max(0, targetCard.getLeft() - dp(32)), 0);
                    }
                }
            });
        } else {
            tvQueuePanel.setVisibility(View.GONE);
            if (returnFocus != null && returnFocus.isShown()) {
                returnFocus.requestFocus();
            }
            schedulePlayerControlsHide();
        }
    }

    private void togglePlayPauseFromRemote(boolean fromHiddenHud) {
        if (player == null) {
            return;
        }
        if (player.isPlaying()) {
            player.pause();
            showCenterAction(R.drawable.ic_pause_tv, "Пауза");
            if (fromHiddenHud) {
                setTvHudVisible(true, tvPlayPauseButton);
            }
        } else {
            if (player.getPlaybackState() == Player.STATE_ENDED) {
                player.seekTo(0L);
            }
            player.play();
            showCenterAction(R.drawable.ic_play_tv, "Воспроизведение");
            if (!fromHiddenHud && tvHudVisible) {
                schedulePlayerControlsHide();
            }
        }
        updateTvPlayPauseIcon();
    }

    private void triggerButtonSeek(long deltaMs) {
        if (player == null) {
            return;
        }
        seekPlayerSilentBy(deltaMs);
        int dir = deltaMs < 0 ? -1 : 1;
        long now = SystemClock.elapsedRealtime();
        if (now - lastQuickSeekEventMs > 1_150L || quickSeekDirection != dir) {
            quickSeekAccumulatedMs = 0L;
        }
        quickSeekDirection = dir;
        quickSeekAccumulatedMs += Math.abs(deltaMs);
        lastQuickSeekEventMs = now;
        showSideSeekIndicator(dir, quickSeekAccumulatedMs);
        updateTvPlayerProgressUi();
        schedulePlayerControlsHide();
    }

    private long seekPlayerSilentBy(long offsetMs) {
        if (player == null) {
            return 0L;
        }
        long targetPosition = Math.max(0L, player.getCurrentPosition() + offsetMs);
        long duration = player.getDuration();
        if (duration > 0L) {
            targetPosition = Math.min(targetPosition, duration);
        }
        player.seekTo(targetPosition);
        return targetPosition;
    }

    private void playPreviousOrRestart() {
        if (player == null) {
            return;
        }
        // Classic YouTube behavior: if > 5s into video, restart it; else go to previous video
        if (player.getCurrentPosition() > 5_000L || playbackIndex <= 0) {
            player.seekTo(0L);
            player.play();
            showCenterAction(R.drawable.ic_skip_prev_tv, "С начала");
        } else {
            saveCurrentVideoProgress(true);
            int prevIndex = playbackIndex - 1;
            VideoFile prevVideo = playbackQueue.get(prevIndex);
            player.seekTo(prevIndex, getSavedVideoPosition(prevVideo.id));
            player.play();
            showCenterAction(R.drawable.ic_skip_prev_tv, "Предыдущее");
        }
        updateTvPlayerProgressUi();
        if (tvHudVisible) schedulePlayerControlsHide();
    }

    private void playNextInQueue() {
        if (player == null) {
            return;
        }
        if (playbackIndex + 1 < playbackQueue.size()) {
            saveCurrentVideoProgress(true);
            int nextIndex = playbackIndex + 1;
            VideoFile nextVideo = playbackQueue.get(nextIndex);
            player.seekTo(nextIndex, getSavedVideoPosition(nextVideo.id));
            player.play();
            showCenterAction(R.drawable.ic_skip_next_tv, "Следующее");
        } else if (playerRepeatMode == Player.REPEAT_MODE_ALL && !playbackQueue.isEmpty()) {
            saveCurrentVideoProgress(true);
            VideoFile firstVideo = playbackQueue.get(0);
            player.seekTo(0, getSavedVideoPosition(firstVideo.id));
            player.play();
            showCenterAction(R.drawable.ic_skip_next_tv, "В начало очереди");
        } else {
            showCenterAction(R.drawable.ic_skip_next_tv, "Конец очереди");
        }
        if (tvHudVisible) schedulePlayerControlsHide();
    }

    private void handleTvMediaItemFinished() {
        if (player == null || !isTvLayout()) {
            return;
        }
        if (selectedVideo != null) {
            clearVideoProgress(selectedVideo.id);
        }
        if (sleepTimerEndAtMs == -1L) {
            sleepTimerEndAtMs = 0L;
            updateTvControlStates();
            setTvHudVisible(true, tvPlayPauseButton);
            showCenterAction(R.drawable.ic_pause_tv, "Таймер сна: остановлено");
            return;
        }
        if (playerRepeatMode == Player.REPEAT_MODE_ONE) {
            player.seekTo(0L);
            player.play();
            return;
        }
        int nextIdx = -1;
        if (playbackIndex + 1 < playbackQueue.size()) {
            nextIdx = playbackIndex + 1;
        } else if (playerRepeatMode == Player.REPEAT_MODE_ALL && playbackQueue.size() > 1) {
            nextIdx = 0;
        }
        if (playerAutoplay && nextIdx >= 0) {
            showUpNextOverlay(nextIdx);
        } else {
            setTvHudVisible(true, tvPlayPauseButton);
        }
    }

    private void showUpNextOverlay(int nextIndex) {
        if (tvUpNextOverlay == null || nextIndex < 0 || nextIndex >= playbackQueue.size()) {
            return;
        }
        VideoFile nextVideo = playbackQueue.get(nextIndex);
        tvUpNextTargetIndex = nextIndex;
        tvUpNextVisible = true;
        tvUpNextCountdownSec = 5;
        setTvHudVisible(false, null);

        if (tvUpNextTitleView != null) {
            tvUpNextTitleView.setText(nextVideo.title);
        }
        if (tvUpNextDurationView != null) {
            String d = nextVideo.duration == null ? "" : nextVideo.duration.trim();
            tvUpNextDurationView.setText(d);
            tvUpNextDurationView.setVisibility(d.isEmpty() ? View.GONE : View.VISIBLE);
        }
        if (tvUpNextPosterView != null) {
            tvUpNextPosterView.setImageDrawable(null);
            tvUpNextPosterView.setAlpha(0f);
            loadPosterInto(tvUpNextPosterView, nextVideo);
        }

        tvUpNextOverlay.animate().cancel();
        tvUpNextOverlay.setVisibility(View.VISIBLE);
        tvUpNextOverlay.setAlpha(0f);
        tvUpNextOverlay.animate().alpha(1f).setDuration(180L).start();
        if (tvUpNextPlayNowBtn != null) {
            tvUpNextOverlay.post(() -> tvUpNextPlayNowBtn.requestFocus());
        }
        if (playerView != null) {
            playerView.removeCallbacks(upNextCountdownRunnable);
            upNextCountdownRunnable.run();
        }
    }

    private void playUpNextTarget() {
        int target = tvUpNextTargetIndex;
        dismissUpNextOverlay(false);
        if (player != null && target >= 0 && target < playbackQueue.size()) {
            VideoFile nextVideo = playbackQueue.get(target);
            player.seekTo(target, getSavedVideoPosition(nextVideo.id));
            player.play();
        }
    }

    private void dismissUpNextOverlay(boolean revealHud) {
        tvUpNextVisible = false;
        tvUpNextTargetIndex = -1;
        if (playerView != null) {
            playerView.removeCallbacks(upNextCountdownRunnable);
        }
        if (tvUpNextOverlay != null) {
            tvUpNextOverlay.animate().cancel();
            tvUpNextOverlay.setVisibility(View.GONE);
        }
        if (revealHud && "player".equals(page) && isTvLayout()) {
            setTvHudVisible(true, tvPlayPauseButton);
        }
    }

    private void showSideSeekIndicator(int direction, long accumulatedMs) {
        LinearLayout target = direction < 0 ? tvSeekLeftOverlay : tvSeekRightOverlay;
        LinearLayout other = direction < 0 ? tvSeekRightOverlay : tvSeekLeftOverlay;
        TextView label = direction < 0 ? tvSeekLeftLabel : tvSeekRightLabel;
        if (target == null || label == null) {
            return;
        }
        if (other != null) {
            other.animate().cancel();
            other.setVisibility(View.GONE);
        }
        long secs = Math.max(1L, accumulatedMs / 1000L);
        label.setText((direction < 0 ? "−" : "+") + secs + " сек");
        target.animate().cancel();
        target.setVisibility(View.VISIBLE);
        target.setAlpha(1f);
        target.setScaleX(0.92f);
        target.setScaleY(0.92f);
        target.animate().scaleX(1f).scaleY(1f).setDuration(110L).start();

        if (playerView != null) {
            playerView.removeCallbacks(hideSeekFeedback);
            playerView.postDelayed(hideSeekFeedback, 1_450L);
        }
    }

    private void showMiniProgressOverlay() {
        if (tvMiniProgressContainer == null || tvHudVisible || player == null) {
            return;
        }
        long pos = Math.max(0L, player.getCurrentPosition());
        long dur = Math.max(0L, player.getDuration());
        long buf = Math.max(0L, player.getBufferedPosition());
        if (tvMiniSeekBar != null) {
            tvMiniSeekBar.setDuration(dur);
            tvMiniSeekBar.setBufferedPosition(buf);
            tvMiniSeekBar.setPosition(pos);
        }
        if (tvMiniTimeLabel != null) {
            tvMiniTimeLabel.setText(TvSeekBar.formatTime(pos) + "  /  " + TvSeekBar.formatTime(dur));
        }
        tvMiniProgressContainer.animate().cancel();
        tvMiniProgressContainer.setVisibility(View.VISIBLE);
        tvMiniProgressContainer.setAlpha(1f);
    }

    private void showCenterAction(int iconRes, String caption) {
        if (tvCenterActionOverlay == null || tvCenterActionIcon == null || tvCenterActionLabel == null) {
            return;
        }
        tvCenterActionIcon.setImageResource(iconRes);
        tvCenterActionLabel.setText(caption);
        tvCenterActionLabel.setVisibility(caption == null || caption.isEmpty() ? View.GONE : View.VISIBLE);
        tvCenterActionOverlay.animate().cancel();
        tvCenterActionOverlay.setVisibility(View.VISIBLE);
        tvCenterActionOverlay.setAlpha(0.96f);
        tvCenterActionOverlay.setScaleX(0.88f);
        tvCenterActionOverlay.setScaleY(0.88f);
        tvCenterActionOverlay.animate().scaleX(1f).scaleY(1f).setDuration(120L).start();
        if (playerView != null) {
            playerView.removeCallbacks(hideCenterAction);
            playerView.postDelayed(hideCenterAction, 1_050L);
        }
    }

    private void fadeOutOverlay(View view) {
        if (view == null || view.getVisibility() != View.VISIBLE) {
            return;
        }
        view.animate().cancel();
        view.animate().alpha(0f).setDuration(180L).withEndAction(() -> {
            if (view.getAlpha() <= 0.05f) {
                view.setVisibility(View.GONE);
            }
        }).start();
    }

    private void updateTvPlayPauseIcon() {
        if (tvPlayPauseIcon == null || player == null) {
            return;
        }
        tvPlayPauseIcon.setImageResource(player.isPlaying() ? R.drawable.ic_pause_tv : R.drawable.ic_play_tv);
    }

    private void updateTvControlStates() {
        updateTvPlayPauseIcon();
        if (tvQueueButton != null) {
            tvQueueButton.setTag(tvQueueOpen);
            styleTvPlayerControl(tvQueueButton, tvQueueButton.hasFocus());
        }
        if (tvSpeedButton != null) {
            String speedText = formatSpeedLabel(playerSpeed);
            tvSpeedButton.setText(speedText);
            tvSpeedButton.setTag(Math.abs(playerSpeed - 1.0f) > 0.01f);
            styleTvPlayerControl(tvSpeedButton, tvSpeedButton.hasFocus());
        }
        if (tvAspectButton != null) {
            tvAspectButton.setTag(playerResizeMode != AspectRatioFrameLayout.RESIZE_MODE_FIT);
            styleTvPlayerControl(tvAspectButton, tvAspectButton.hasFocus());
        }
        if (tvRepeatButton != null && tvRepeatIcon != null) {
            tvRepeatIcon.setImageResource(
                playerRepeatMode == Player.REPEAT_MODE_ONE ? R.drawable.ic_repeat_one_tv : R.drawable.ic_repeat_tv
            );
            tvRepeatButton.setTag(playerRepeatMode != Player.REPEAT_MODE_OFF);
            styleTvPlayerControl(tvRepeatButton, tvRepeatButton.hasFocus());
        }
        if (tvAutoplayButton != null) {
            tvAutoplayButton.setTag(playerAutoplay);
            styleTvPlayerControl(tvAutoplayButton, tvAutoplayButton.hasFocus());
        }
        rebuildTvStatusBadges();
    }

    private void rebuildTvStatusBadges() {
        if (tvStatusBadgesRow == null) {
            return;
        }
        tvStatusBadgesRow.removeAllViews();
        if (castSenderName != null && !castSenderName.trim().isEmpty()) {
            tvStatusBadgesRow.addView(tvCastSenderBadge(castSenderName.trim()));
        }
        if (Math.abs(playerSpeed - 1.0f) > 0.01f) {
            tvStatusBadgesRow.addView(tvTopStatusBadge(formatSpeedLabel(playerSpeed)));
        }
        if (playerRepeatMode == Player.REPEAT_MODE_ONE) {
            tvStatusBadgesRow.addView(tvTopStatusBadge("Повтор 1"));
        } else if (playerRepeatMode == Player.REPEAT_MODE_ALL) {
            tvStatusBadgesRow.addView(tvTopStatusBadge("Повтор все"));
        }
        if (sleepTimerEndAtMs == -1L) {
            tvStatusBadgesRow.addView(tvTopStatusBadge("Сон · конец видео"));
        } else if (sleepTimerEndAtMs > 0L) {
            long remMin = Math.max(1L, (sleepTimerEndAtMs - SystemClock.elapsedRealtime() + 59_999L) / 60_000L);
            tvStatusBadgesRow.addView(tvTopStatusBadge("Сон · " + remMin + " мин"));
        }
    }

    private LinearLayout tvCastSenderBadge(String sender) {
        LinearLayout pill = new LinearLayout(this);
        pill.setOrientation(LinearLayout.HORIZONTAL);
        pill.setGravity(Gravity.CENTER_VERTICAL);
        pill.setPadding(dp(11), dp(5), dp(12), dp(5));
        pill.setBackground(makeMaterialSurfaceDrawable(ACCENT_SOFT, 0, 999, 0));

        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.ic_cast_connected_tv);
        icon.setColorFilter(ACCENT);
        icon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        pill.addView(icon, new LinearLayout.LayoutParams(dp(14), dp(14)));

        TextView label = text("От: " + sender, 12, ACCENT_LIGHT, true);
        label.setPadding(dp(7), 0, 0, 0);
        label.setMaxLines(1);
        label.setEllipsize(TextUtils.TruncateAt.END);
        pill.addView(label);

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.rightMargin = dp(8);
        pill.setLayoutParams(lp);
        return pill;
    }

    private TextView tvTopStatusBadge(String label) {
        TextView badge = text(label, 11, ACCENT, true);
        badge.setPadding(dp(10), dp(4), dp(10), dp(4));
        badge.setBackground(makeMaterialSurfaceDrawable(ACCENT_SOFT, 0, 999, 0));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.rightMargin = dp(6);
        badge.setLayoutParams(lp);
        return badge;
    }

    private void updateTvPlayerProgressUi() {
        if (player == null) {
            return;
        }
        long pos = Math.max(0L, player.getCurrentPosition());
        long dur = Math.max(0L, player.getDuration());
        long buf = Math.max(0L, player.getBufferedPosition());

        if (tvSeekBar != null) {
            tvSeekBar.setDuration(dur);
            tvSeekBar.setBufferedPosition(buf);
            tvSeekBar.setPosition(pos);
        }
        if (tvCurrentTimeView != null) {
            tvCurrentTimeView.setText(TvSeekBar.formatTime(pos));
        }
        if (tvTotalTimeView != null) {
            if (dur > 0L) {
                long remaining = Math.max(0L, dur - pos);
                tvTotalTimeView.setText("−" + TvSeekBar.formatTime(remaining) + "  ·  " + TvSeekBar.formatTime(dur));
            } else {
                tvTotalTimeView.setText("0:00");
            }
        }
        if (tvClockView != null) {
            SimpleDateFormat clockFmt = new SimpleDateFormat("HH:mm", Locale.getDefault());
            long nowWall = System.currentTimeMillis();
            tvClockView.setText(clockFmt.format(new Date(nowWall)));
            if (tvFinishTimeView != null) {
                if (dur > pos) {
                    long realRemMs = Math.round((dur - pos) / Math.max(0.25f, playerSpeed));
                    tvFinishTimeView.setText("до " + clockFmt.format(new Date(nowWall + realRemMs)));
                    tvFinishTimeView.setVisibility(View.VISIBLE);
                } else {
                    tvFinishTimeView.setVisibility(View.GONE);
                }
            }
        }

        // Check active Sleep Timer
        if (sleepTimerEndAtMs > 0L) {
            if (SystemClock.elapsedRealtime() >= sleepTimerEndAtMs) {
                sleepTimerEndAtMs = 0L;
                player.pause();
                updateTvControlStates();
                setTvHudVisible(true, tvPlayPauseButton);
                showCenterAction(R.drawable.ic_pause_tv, "Таймер сна: остановлено");
            } else {
                rebuildTvStatusBadges();
            }
        }

        if (playerStatsVisible) {
            updateStatsOverlayText();
        }
        saveCurrentVideoProgress(false);
    }

    private void showTvSpeedDialog() {
        cancelPlayerControlsHide();
        String[] labels = {"0.5x", "0.75x", "1x (Обычная)", "1.25x", "1.5x", "1.75x", "2x"};
        int checked = 2;
        for (int i = 0; i < PLAYBACK_SPEEDS.length; i++) {
            if (Math.abs(PLAYBACK_SPEEDS[i] - playerSpeed) < 0.02f) {
                checked = i;
                break;
            }
        }
        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
            .setTitle("Скорость воспроизведения")
            .setSingleChoiceItems(labels, checked, (d, which) -> {
                playerSpeed = PLAYBACK_SPEEDS[which];
                if (player != null) {
                    player.setPlaybackSpeed(playerSpeed);
                }
                updateTvControlStates();
                updateTvPlayerProgressUi();
                showCenterAction(R.drawable.ic_speed_tv, formatSpeedLabel(playerSpeed));
                d.dismiss();
            })
            .setNegativeButton("Отмена", null)
            .create();
        dialog.setOnDismissListener(d -> schedulePlayerControlsHide());
        dialog.show();
    }

    private String formatSpeedLabel(float speed) {
        if (Math.abs(speed - 1.0f) < 0.01f) return "1x";
        if (Math.abs(speed - Math.round(speed)) < 0.01f) return Math.round(speed) + "x";
        return String.format(Locale.US, "%sx", speed).replaceAll("0+$", "");
    }

    private void cycleTvAspectMode() {
        String label;
        if (playerResizeMode == AspectRatioFrameLayout.RESIZE_MODE_FIT) {
            playerResizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM;
            label = "Экран: Заполнить";
        } else if (playerResizeMode == AspectRatioFrameLayout.RESIZE_MODE_ZOOM) {
            playerResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL;
            label = "Экран: Растянуть";
        } else {
            playerResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT;
            label = "Экран: Вместить";
        }
        getPreferences(MODE_PRIVATE).edit().putInt("playerResizeMode", playerResizeMode).apply();
        if (playerView != null) {
            playerView.setResizeMode(playerResizeMode);
        }
        updateTvControlStates();
        showCenterAction(R.drawable.ic_aspect_tv, label);
        schedulePlayerControlsHide();
    }

    private void cycleTvRepeatMode() {
        String label;
        int icon;
        if (playerRepeatMode == Player.REPEAT_MODE_OFF) {
            playerRepeatMode = Player.REPEAT_MODE_ONE;
            label = "Повтор: 1 видео";
            icon = R.drawable.ic_repeat_one_tv;
        } else if (playerRepeatMode == Player.REPEAT_MODE_ONE) {
            playerRepeatMode = Player.REPEAT_MODE_ALL;
            label = "Повтор: вся очередь";
            icon = R.drawable.ic_repeat_tv;
        } else {
            playerRepeatMode = Player.REPEAT_MODE_OFF;
            label = "Повтор: выкл";
            icon = R.drawable.ic_repeat_tv;
        }
        if (player != null) {
            player.setRepeatMode(playerRepeatMode);
            player.setPauseAtEndOfMediaItems(isTvLayout() && playerRepeatMode != Player.REPEAT_MODE_ONE);
        }
        updateTvControlStates();
        showCenterAction(icon, label);
        schedulePlayerControlsHide();
    }

    private void toggleTvAutoplay() {
        playerAutoplay = !playerAutoplay;
        getPreferences(MODE_PRIVATE).edit().putBoolean("playerAutoplay", playerAutoplay).apply();
        updateTvControlStates();
        showCenterAction(R.drawable.ic_autoplay_tv, playerAutoplay ? "Автовоспроизведение: Вкл" : "Автовоспроизведение: Выкл");
        schedulePlayerControlsHide();
    }

    private void showTvTracksMenuDialog() {
        if (player == null) {
            return;
        }
        cancelPlayerControlsHide();
        String[] categories = {
            "Аудиодорожка  ·  " + activeTrackSummary(C.TRACK_TYPE_AUDIO),
            "Субтитры  ·  " + activeTrackSummary(C.TRACK_TYPE_TEXT),
            "Качество видео  ·  " + activeTrackSummary(C.TRACK_TYPE_VIDEO)
        };
        final boolean[] openedSub = {false};
        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
            .setTitle("Дорожки и качество")
            .setItems(categories, (d, which) -> {
                openedSub[0] = true;
                if (which == 0) showTvTrackPickerDialog(C.TRACK_TYPE_AUDIO, "Аудиодорожка");
                else if (which == 1) showTvTrackPickerDialog(C.TRACK_TYPE_TEXT, "Субтитры");
                else showTvTrackPickerDialog(C.TRACK_TYPE_VIDEO, "Качество видео");
            })
            .setNegativeButton("Закрыть", null)
            .create();
        dialog.setOnDismissListener(d -> {
            if (!openedSub[0]) schedulePlayerControlsHide();
        });
        dialog.show();
    }

    private String activeTrackSummary(int trackType) {
        if (player == null) return "Авто";
        if (trackType == C.TRACK_TYPE_TEXT
            && player.getTrackSelectionParameters().disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)) {
            return "Выкл";
        }
        Tracks tracks = player.getCurrentTracks();
        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() != trackType) continue;
            for (int i = 0; i < group.length; i++) {
                if (group.isTrackSelected(i)) {
                    return describeTrackFormat(trackType, group.getTrackFormat(i), i + 1);
                }
            }
        }
        return trackType == C.TRACK_TYPE_TEXT ? "Выкл" : "Авто";
    }

    private void showTvTrackPickerDialog(int trackType, String title) {
        if (player == null) return;
        cancelPlayerControlsHide();

        final List<String> labels = new ArrayList<>();
        final List<Tracks.Group> groups = new ArrayList<>();
        final List<Integer> indices = new ArrayList<>();
        int checked = 0;

        boolean textDisabled = trackType == C.TRACK_TYPE_TEXT
            && player.getTrackSelectionParameters().disabledTrackTypes.contains(C.TRACK_TYPE_TEXT);

        labels.add(trackType == C.TRACK_TYPE_TEXT ? "Выкл (Без субтитров)" : "Авто (По умолчанию)");
        groups.add(null);
        indices.add(-1);

        boolean hasOverride = !player.getTrackSelectionParameters().overrides.isEmpty();
        Tracks tracks = player.getCurrentTracks();
        int counter = 1;
        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() != trackType) continue;
            for (int i = 0; i < group.length; i++) {
                if (!group.isTrackSupported(i)) continue;
                Format fmt = group.getTrackFormat(i);
                labels.add(describeTrackFormat(trackType, fmt, counter++));
                groups.add(group);
                indices.add(i);
                if (!textDisabled && group.isTrackSelected(i) && (trackType == C.TRACK_TYPE_TEXT || hasOverride)) {
                    checked = labels.size() - 1;
                }
            }
        }

        if (labels.size() == 1) {
            toastDialog(title, trackType == C.TRACK_TYPE_TEXT
                ? "В этом видео нет встроенных субтитров."
                : "Доступна только одна дорожка по умолчанию.");
            schedulePlayerControlsHide();
            return;
        }

        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
            .setTitle(title)
            .setSingleChoiceItems(labels.toArray(new String[0]), checked, (d, which) -> {
                if (player != null) {
                    TrackSelectionParameters.Builder builder = player.getTrackSelectionParameters().buildUpon();
                    if (which == 0) {
                        builder.clearOverridesOfType(trackType);
                        builder.setTrackTypeDisabled(trackType, trackType == C.TRACK_TYPE_TEXT);
                    } else {
                        builder.setTrackTypeDisabled(trackType, false);
                        builder.setOverrideForType(new TrackSelectionOverride(
                            groups.get(which).getMediaTrackGroup(),
                            indices.get(which)
                        ));
                    }
                    player.setTrackSelectionParameters(builder.build());
                    showCenterAction(R.drawable.ic_subtitles_tv, labels.get(which));
                }
                d.dismiss();
            })
            .setNegativeButton("Отмена", null)
            .create();
        dialog.setOnDismissListener(d -> schedulePlayerControlsHide());
        dialog.show();
    }

    private String describeTrackFormat(int trackType, Format fmt, int index) {
        if (trackType == C.TRACK_TYPE_VIDEO) {
            String res = fmt.height > 0 ? fmt.height + "p" : ("Поток " + index);
            if (fmt.height >= 2160) res = "2160p 4K";
            if (fmt.frameRate > 0) res += " " + Math.round(fmt.frameRate) + "fps";
            if (fmt.bitrate > 0) res += String.format(Locale.US, " · %.1f Мбит/с", fmt.bitrate / 1_000_000f);
            return res;
        }
        StringBuilder sb = new StringBuilder();
        if (fmt.language != null && !fmt.language.isEmpty() && !"und".equalsIgnoreCase(fmt.language)) {
            String lang = new Locale(fmt.language).getDisplayLanguage(new Locale("ru"));
            if (!lang.isEmpty()) {
                sb.append(Character.toUpperCase(lang.charAt(0))).append(lang.substring(1));
            }
        }
        if (fmt.label != null && !fmt.label.trim().isEmpty()) {
            if (sb.length() > 0) sb.append(" · ");
            sb.append(fmt.label.trim());
        }
        if (sb.length() == 0) {
            sb.append((trackType == C.TRACK_TYPE_AUDIO ? "Дорожка " : "Субтитры ") + index);
        }
        if (trackType == C.TRACK_TYPE_AUDIO && fmt.channelCount > 0) {
            String ch = fmt.channelCount >= 8 ? "7.1" : (fmt.channelCount >= 6 ? "5.1" : (fmt.channelCount == 2 ? "Стерео" : "Моно"));
            sb.append(" · ").append(ch);
        }
        return sb.toString();
    }

    private void showTvMoreDialog() {
        cancelPlayerControlsHide();
        String sleepLabel = sleepTimerEndAtMs == 0L
            ? "Выкл"
            : (sleepTimerEndAtMs == -1L
                ? "В конце видео"
                : Math.max(1L, (sleepTimerEndAtMs - SystemClock.elapsedRealtime() + 59_999L) / 60_000L) + " мин");
        String[] options = {
            "С начала (0:00)",
            "Таймер сна  ·  " + sleepLabel,
            playerStatsVisible ? "Скрыть статистику для сисадминов" : "Статистика для сисадминов",
            "Сообщить о проблеме"
        };
        final boolean[] openedSub = {false};
        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
            .setTitle("Дополнительно")
            .setItems(options, (d, which) -> {
                if (which == 0 && player != null) {
                    player.seekTo(0L);
                    player.play();
                    showCenterAction(R.drawable.ic_skip_prev_tv, "С начала");
                } else if (which == 1) {
                    openedSub[0] = true;
                    showTvSleepTimerDialog();
                } else if (which == 2) {
                    playerStatsVisible = !playerStatsVisible;
                    updateStatsOverlayVisibility();
                } else if (which == 3) {
                    openedSub[0] = true;
                    showVideoReport();
                }
            })
            .setNegativeButton("Закрыть", null)
            .create();
        dialog.setOnDismissListener(d -> {
            if (!openedSub[0]) schedulePlayerControlsHide();
        });
        dialog.show();
    }

    private void showTvSleepTimerDialog() {
        cancelPlayerControlsHide();
        String[] options = {"Выключить таймер", "Через 15 минут", "Через 30 минут", "Через 45 минут", "Через 60 минут", "После этого видео"};
        final long[] minutes = {0, 15, 30, 45, 60, -1};
        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
            .setTitle("Таймер сна")
            .setItems(options, (d, which) -> {
                long m = minutes[which];
                if (m == 0) {
                    sleepTimerEndAtMs = 0L;
                    showCenterAction(R.drawable.ic_pause_tv, "Таймер сна выкл");
                } else if (m < 0) {
                    sleepTimerEndAtMs = -1L;
                    showCenterAction(R.drawable.ic_pause_tv, "Пауза после видео");
                } else {
                    sleepTimerEndAtMs = SystemClock.elapsedRealtime() + m * 60_000L;
                    showCenterAction(R.drawable.ic_pause_tv, "Таймер: " + m + " мин");
                }
                updateTvControlStates();
            })
            .setNegativeButton("Отмена", null)
            .create();
        dialog.setOnDismissListener(d -> schedulePlayerControlsHide());
        dialog.show();
    }

    private void updateStatsOverlayVisibility() {
        if (tvStatsOverlay == null) return;
        tvStatsOverlay.setVisibility(playerStatsVisible ? View.VISIBLE : View.GONE);
        if (playerStatsVisible) {
            updateStatsOverlayText();
        }
    }

    private void updateStatsOverlayText() {
        if (!playerStatsVisible || tvStatsBody == null || player == null) {
            return;
        }
        Format vf = player.getVideoFormat();
        Format af = player.getAudioFormat();
        String videoLine = vf == null
            ? "Определение…"
            : (vf.width + "×" + vf.height
                + (vf.frameRate > 0 ? " @ " + Math.round(vf.frameRate) + " fps" : "")
                + (vf.codecs != null ? " · " + vf.codecs : ""));
        String audioLine = af == null
            ? "—"
            : ((af.codecs != null ? af.codecs : (af.sampleMimeType != null ? af.sampleMimeType : "audio"))
                + (af.channelCount > 0 ? " · " + af.channelCount + " ch" : "")
                + (af.sampleRate > 0 ? " · " + (af.sampleRate / 1000) + " kHz" : ""));
        long bufAheadSec = Math.max(0L, (player.getBufferedPosition() - player.getCurrentPosition()) / 1000L);
        String scaleName = playerResizeMode == AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            ? "Заполнить"
            : (playerResizeMode == AspectRatioFrameLayout.RESIZE_MODE_FILL ? "Растянуть" : "Вместить");
        String streamType = selectedVideo != null && selectedVideo.usesHls() ? "HLS (MKV)" : "Direct HTTP";
        String size = selectedVideo != null && selectedVideo.size != null && !selectedVideo.size.isEmpty() ? selectedVideo.size : "—";

        tvStatsBody.setText(
            "Видео: " + videoLine + "\n"
            + "Аудио: " + audioLine + "\n"
            + "Буфер: +" + bufAheadSec + " сек  ·  Поток: " + streamType + "\n"
            + "Скорость: " + formatSpeedLabel(playerSpeed) + "  ·  Экран: " + scaleName + "\n"
            + "Размер: " + size
        );
    }

    private void addThumbnailProgressBar(FrameLayout poster, float fraction) {
        float clamped = Math.max(0.02f, Math.min(1f, fraction));
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setWeightSum(1f);
        View played = new View(this);
        played.setBackgroundColor(ACCENT);
        View rest = new View(this);
        rest.setBackgroundColor(Color.argb(85, 255, 255, 255));
        bar.addView(played, new LinearLayout.LayoutParams(0, -1, clamped));
        bar.addView(rest, new LinearLayout.LayoutParams(0, -1, 1f - clamped));
        poster.addView(bar, new FrameLayout.LayoutParams(-1, dp(3), Gravity.BOTTOM));
    }

    private void saveCurrentVideoProgress(boolean force) {
        if (player == null || selectedVideo == null || selectedVideo.id == null || selectedVideo.id.isEmpty()) {
            return;
        }
        long now = SystemClock.elapsedRealtime();
        if (!force && now - lastProgressSaveAtMs < 3_000L) {
            return;
        }
        long duration = player.getDuration();
        long position = player.getCurrentPosition();
        if (duration <= 20_000L) {
            return;
        }
        lastProgressSaveAtMs = now;
        android.content.SharedPreferences prefs = getSharedPreferences("video_progress", MODE_PRIVATE);
        if (position >= duration * 95L / 100L) {
            prefs.edit().remove("pos_" + selectedVideo.id).remove("dur_" + selectedVideo.id).apply();
        } else if (position >= 8_000L) {
            prefs.edit()
                .putLong("pos_" + selectedVideo.id, position)
                .putLong("dur_" + selectedVideo.id, duration)
                .apply();
        }
    }

    private long getSavedVideoPosition(String videoId) {
        if (videoId == null || videoId.isEmpty()) return 0L;
        return Math.max(0L, getSharedPreferences("video_progress", MODE_PRIVATE).getLong("pos_" + videoId, 0L));
    }

    private float getSavedVideoProgressFraction(String videoId) {
        if (videoId == null || videoId.isEmpty()) return 0f;
        android.content.SharedPreferences prefs = getSharedPreferences("video_progress", MODE_PRIVATE);
        long pos = prefs.getLong("pos_" + videoId, 0L);
        long dur = prefs.getLong("dur_" + videoId, 0L);
        if (pos <= 0L || dur <= 0L) return 0f;
        return Math.max(0f, Math.min(1f, pos / (float) dur));
    }

    private void clearVideoProgress(String videoId) {
        if (videoId == null || videoId.isEmpty()) return;
        getSharedPreferences("video_progress", MODE_PRIVATE).edit()
            .remove("pos_" + videoId)
            .remove("dur_" + videoId)
            .apply();
    }

    private String playerFileSubtitle(VideoFile video) {
        if (video == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        if (video.folderName != null && !video.folderName.trim().isEmpty()) {
            sb.append(video.folderName.trim());
        }
        if (video.resolution != null && !video.resolution.trim().isEmpty()) {
            if (sb.length() > 0) sb.append("  •  ");
            sb.append(video.resolution.trim());
        }
        if (video.codec != null && !video.codec.trim().isEmpty()) {
            if (sb.length() > 0) sb.append("  •  ");
            sb.append(video.codec.trim().toUpperCase(Locale.ROOT));
        }
        if (video.size != null && !video.size.trim().isEmpty()) {
            if (sb.length() > 0) sb.append("  •  ");
            sb.append(video.size.trim());
        }
        if (playbackQueue.size() > 1 && playbackIndex >= 0) {
            if (sb.length() > 0) sb.append("  •  ");
            sb.append((playbackIndex + 1)).append(" / ").append(playbackQueue.size());
        }
        if (sb.length() == 0 && video.path != null) {
            return video.path;
        }
        return sb.toString();
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
            timeBar.setScrubberColor(ACCENT_LIGHT);
            timeBar.setBufferedColor(Color.argb(180, 148, 163, 184));
            timeBar.setUnplayedColor(Color.argb(150, 60, 60, 60));
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
                if (!isTvLayout()) {
                    ViewGroup.LayoutParams size = control.getLayoutParams();
                    size.width = dp(38);
                    size.height = dp(38);
                    control.setLayoutParams(size);
                }
                allowFocusOverflow(control, view);
                applyPlayerControlFocus(control);
            }
        }

        View settings = view.findViewById(androidx.media3.ui.R.id.exo_settings);
        if (settings != null) {
            ViewGroup parent = (ViewGroup) settings.getParent();
            TextView more = text("⋮", 22, Color.WHITE, true);
            more.setId(View.generateViewId());
            more.setGravity(Gravity.CENTER);
            more.setContentDescription("Действия с видео");
            applyPlayerControlFocus(more);
            more.setOnClickListener(anchor -> {
                PopupMenu menu = new PopupMenu(this, anchor);
                menu.getMenu().add("Сообщить о проблеме").setOnMenuItemClickListener(item -> {
                    showVideoReport();
                    return true;
                });
                menu.show();
            });
            parent.addView(more, parent.indexOfChild(settings) + 1, new ViewGroup.LayoutParams(dp(38), dp(38)));
        }
    }

    private void showVideoReport() {
        VideoFile video = selectedVideo;
        if (video == null || player == null) return;
        cancelPlayerControlsHide();
        long position = Math.max(0, player.getCurrentPosition() / 1000);
        String[] reasons = {"Зависает или повторяет кадры", "Нет звука или звук отстаёт", "Не открывается", "Другая проблема"};
        AlertDialog first = new MaterialAlertDialogBuilder(this).setTitle("Проблема с видео")
            .setItems(reasons, (dialog, index) -> {
                EditText comment = input("Комментарий", "");
                AlertDialog second = new MaterialAlertDialogBuilder(this).setTitle(reasons[index]).setView(comment)
                    .setNegativeButton("Отмена", null)
                    .setPositiveButton("Отправить", (details, button) -> {
                        String note = comment.getText().toString().trim();
                        new Thread(() -> {
                            try {
                                SimpleDateFormat timestamp = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
                                timestamp.setTimeZone(TimeZone.getTimeZone("UTC"));
                                JSONObject payload = new JSONObject().put("videoId", video.id)
                                    .put("title", video.title).put("reason", reasons[index])
                                    .put("positionSecond", position).put("comment", note)
                                    .put("status", "open").put("createdAt", timestamp.format(new Date()));
                                apiClient.postJson("/videos/reports", payload);
                                runOnUiThread(() -> toastDialog("Жалоба отправлена", "Администратор получит время сбоя."));
                            } catch (Exception error) {
                                runOnUiThread(() -> toastDialog("Ошибка отправки", safeText(error.getMessage())));
                            }
                        }).start();
                    }).create();
                second.setOnDismissListener(d -> schedulePlayerControlsHide());
                second.show();
            }).setNegativeButton("Отмена", null).create();
        first.setOnDismissListener(d -> schedulePlayerControlsHide());
        first.show();
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
        control.setBackground(makeMaterialSurfaceDrawable(
            hasFocus ? ACCENT : Color.argb(215, 23, 25, 32),
            0,
            999,
            0
        ));
        if (control instanceof ImageView) {
            ((ImageView) control).setColorFilter(hasFocus ? DARK : Color.WHITE);
        } else if (control instanceof TextView) {
            ((TextView) control).setTextColor(hasFocus ? DARK : Color.WHITE);
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

    private void renderBottomNav() {
        if (isTvLandscape()) {
            return;
        }

        LinearLayout nav = new LinearLayout(this);
        nav.setGravity(Gravity.CENTER);
        nav.setClipChildren(false);
        nav.setClipToPadding(false);
        nav.setPadding(dp(isTvLayout() ? 36 : 14), dp(10), dp(isTvLayout() ? 36 : 14), dp(isTvLayout() ? 16 : 12));
        nav.setBackground(makeMaterialSurfaceDrawable(SURFACE, 0, 0, 0));
        nav.addView(navButton("Видео", "videos"), new LinearLayout.LayoutParams(0, dp(46), 1));
        addInlineSpace(nav, 8);
        nav.addView(navButton("Файлы", "files"), new LinearLayout.LayoutParams(0, dp(46), 1));
        addInlineSpace(nav, 8);
        nav.addView(navButton(accountNavLabel(), accountNavPage()), new LinearLayout.LayoutParams(0, dp(46), 1));
        if (isAdmin) {
            addInlineSpace(nav, 8);
            nav.addView(navButton("Настройки", "settings"), new LinearLayout.LayoutParams(0, dp(46), 1));
        }
        root.addView(nav);
    }

    private TextView navButton(String label, String targetPage) {
        boolean selected = targetPage.equals(page);
        TextView button = text(label, isTvLandscape() ? 13 : (isTvLayout() ? 15 : 13), selected ? ACCENT : MUTED, true);
        button.setGravity(Gravity.CENTER);
        int normalColor = selected ? ACCENT_SOFT : CARD;
        button.setBackground(makeMaterialSurfaceDrawable(normalColor, 0, 999, 0));
        applyFocus(button, normalColor, ACCENT, 999, 0);
        if (selected) {
            rememberTvFallbackFocus(button);
        }
        button.setOnClickListener(v -> openNavigationPage(targetPage));
        return button;
    }

    private String accountNavLabel() {
        if (isAdmin) return "Админка";
        return accountLogin.isEmpty() ? "Войти" : "Аккаунт";
    }

    private String accountNavPage() {
        if (isAdmin) return "admin";
        return accountLogin.isEmpty() ? "login" : "account";
    }

    private void openNavigationPage(String targetPage) {
        if ("login".equals(targetPage) && !"login".equals(page)) loginReturnPage = page;
        page = targetPage;
        selectedVideo = null;
        render();
    }

    private TextView actionButton(String label, int background, int color) {
        TextView button = text(label, isTvLandscape() ? 13 : (isTvLayout() ? 15 : 14), color, true);
        button.setGravity(Gravity.CENTER);
        button.setMinHeight(dp(isTvLandscape() ? 42 : (isTvLayout() ? 48 : 44)));
        button.setPadding(dp(18), 0, dp(18), 0);
        button.setBackground(makeMaterialSurfaceDrawable(background, 0, 999, 0));
        applyFocus(button, background, background == ACCENT ? ACCENT_LIGHT : ACCENT, 999, 0);
        rememberTvFocus(button);
        return button;
    }

    private void toastDialog(String title, String message) {
        new MaterialAlertDialogBuilder(this)
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
        input.setPadding(dp(18), 0, dp(18), 0);
        input.setTextColor(TEXT);
        input.setHintTextColor(MUTED);
        input.setBackground(makeMaterialSurfaceDrawable(CARD_ELEVATED, 0, 14, 0));
        input.setTextSize(isTvLandscape() ? 14 : (isTvLayout() ? 16 : 15));
        input.setOnFocusChangeListener((v, hasFocus) -> {
            if (hasFocus) {
                allowFocusOverflow(input, null);
            }
            input.setElevation(hasFocus ? dp(6) : 0);
            input.setBackground(makeMaterialSurfaceDrawable(
                hasFocus ? SURFACE_SELECTED : CARD_ELEVATED,
                hasFocus ? ACCENT : 0,
                14,
                hasFocus ? 2 : 0
            ));
        });
        return input;
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(makeMaterialSurfaceDrawable(CARD, 0, 20, 0));
        card.setClipChildren(false);
        card.setClipToPadding(false);
        card.setElevation(dp(2));
        return card;
    }

    private LinearLayout contentListContainer() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setClipChildren(false);
        panel.setClipToPadding(false);
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
        TextView title,
        View playBadge,
        View focusRing
    ) {
        card.setFocusable(true);
        card.setFocusableInTouchMode(isTvLayout());
        card.setOnFocusChangeListener((view, hasFocus) -> {
            if (hasFocus) {
                allowFocusOverflow(card, null);
            }
            preview.animate().cancel();
            preview.animate()
                .scaleX(hasFocus ? 1.038f : 1f)
                .scaleY(hasFocus ? 1.038f : 1f)
                .translationY(hasFocus ? -dp(3) : 0)
                .setDuration(hasFocus ? 145L : 110L)
                .start();
            preview.setElevation(hasFocus ? dp(18) : dp(2));
            if (focusRing != null) {
                focusRing.animate().cancel();
                focusRing.animate().alpha(hasFocus ? 1f : 0f).setDuration(120L).start();
            }
            title.setTextColor(hasFocus ? ACCENT : TEXT);
            if (playBadge != null) {
                playBadge.animate().cancel();
                playBadge.animate()
                    .scaleX(hasFocus ? 1.1f : 1f)
                    .scaleY(hasFocus ? 1.1f : 1f)
                    .setDuration(120L)
                    .start();
            }
        });
    }

    private void applyCardSurfaceFocus(View view, int normalColor, int focusedColor, int radiusDp) {
        view.setFocusable(true);
        view.setFocusableInTouchMode(isTvLayout());
        view.setOnFocusChangeListener((v, hasFocus) -> {
            if (hasFocus) {
                allowFocusOverflow(v, null);
            }
            v.animate().cancel();
            v.animate()
                .scaleX(hasFocus ? 1.015f : 1f)
                .scaleY(hasFocus ? 1.015f : 1f)
                .translationY(hasFocus ? -dp(2) : 0)
                .setDuration(hasFocus ? 130L : 95L)
                .start();
            v.setElevation(hasFocus ? dp(14) : dp(2));
            v.setBackground(makeMaterialSurfaceDrawable(
                hasFocus ? focusedColor : normalColor,
                hasFocus ? ACCENT : 0,
                radiusDp,
                hasFocus ? 2 : 0
            ));
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
        TextView view = text(label, isTvLandscape() ? 13 : 13, selected ? ACCENT : TEXT, true);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(16), 0, dp(16), 0);
        // YouTube / VK Video capsule filter pills (999dp radius, zero border)
        int normalColor = selected ? ACCENT_SOFT : CARD;
        view.setBackground(makeMaterialSurfaceDrawable(normalColor, 0, 999, 0));
        applyFocus(view, normalColor, ACCENT, 999, 0);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(isTvLandscape() ? 36 : (isTvLayout() ? 42 : 36)));
        params.setMargins(0, 0, dp(8), 0);
        view.setLayoutParams(params);
        return view;
    }

    private TextView pill(String label, boolean dark) {
        TextView view = text(label, isTvLandscape() ? 11 : 12, dark ? Color.WHITE : ACCENT, true);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(10), 0, dp(10), 0);
        view.setBackground(makeMaterialSurfaceDrawable(
            dark ? Color.argb(215, 12, 13, 16) : ACCENT_SOFT,
            0,
            999,
            0
        ));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(isTvLandscape() ? 24 : 28));
        params.setMargins(0, 0, dp(6), 0);
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
            return screenWidthDp() >= 1280 ? 5 : 4;
        }
        return isTvLayout() ? 3 : 2;
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
        applyFocus(view, normalColor, focusedColor, 999, 0);
    }

    private void applyFocus(View view, int normalColor, int focusedColor, int radiusDp, int normalStrokeColor) {
        view.setFocusable(true);
        view.setFocusableInTouchMode(isTvLayout());
        final int normalTextColor = view instanceof TextView ? ((TextView) view).getCurrentTextColor() : 0;
        view.setOnFocusChangeListener((v, hasFocus) -> {
            if (hasFocus) {
                allowFocusOverflow(v, null);
            }
            boolean textControl = v instanceof TextView;
            v.animate().cancel();
            v.animate()
                .scaleX(hasFocus ? 1.03f : 1f)
                .scaleY(hasFocus ? 1.03f : 1f)
                .translationY(0)
                .setDuration(hasFocus ? 130L : 90L)
                .start();
            v.setElevation(hasFocus ? dp(isTvLandscape() ? 10 : 12) : 0);
            int activeBackground = textControl ? focusedColor : CARD_ELEVATED;
            v.setBackground(makeMaterialSurfaceDrawable(
                hasFocus ? activeBackground : normalColor,
                0,
                radiusDp,
                0
            ));
            if (textControl) {
                ((TextView) v).setTextColor(hasFocus ? DARK : normalTextColor);
            }
        });
    }

    private Drawable makeMaterialSurfaceDrawable(int fillColor, int strokeColor, int radiusDp, int strokeDp) {
        if (strokeColor != 0 && strokeDp > 0) {
            GradientDrawable stroked = new GradientDrawable();
            stroked.setShape(GradientDrawable.RECTANGLE);
            stroked.setColor(fillColor);
            stroked.setCornerRadius(dp(radiusDp));
            stroked.setStroke(dp(strokeDp), strokeColor);
            return stroked;
        }
        final float requestedPx = dp(radiusDp);
        com.google.android.material.shape.CornerSize clampedCorner =
            bounds -> Math.min(requestedPx, Math.min(bounds.width(), bounds.height()) / 2f);
        com.google.android.material.shape.ShapeAppearanceModel shape =
            new com.google.android.material.shape.ShapeAppearanceModel.Builder()
                .setAllCornerSizes(clampedCorner)
                .build();
        com.google.android.material.shape.MaterialShapeDrawable drawable =
            new com.google.android.material.shape.MaterialShapeDrawable(shape);
        drawable.setFillColor(android.content.res.ColorStateList.valueOf(fillColor));
        return drawable;
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
        boolean hadActivePlayer = player != null;
        saveCurrentVideoProgress(true);
        getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (hadActivePlayer && isTvLayout()) {
            reportTvPlayNow(null, "stopped", true);
        }
        if (seekFeedbackView != null) {
            seekFeedbackView.removeCallbacks(hideSeekFeedback);
        }
        if (tvSeekBar != null) {
            tvSeekBar.removeCallbacks(clearScrubPreview);
        }
        if (playerView != null) {
            playerView.removeCallbacks(hidePlayerControls);
            playerView.removeCallbacks(hideSeekFeedback);
            playerView.removeCallbacks(hideCenterAction);
            playerView.removeCallbacks(playerTickRunnable);
            playerView.removeCallbacks(upNextCountdownRunnable);
            playerView.setControllerVisibilityListener(
                (PlayerView.ControllerVisibilityListener) null
            );
        }
        if (player != null) {
            player.release();
            player = null;
        }
        playerView = null;
        playerMetadataPanel = null;
        playerTitleView = null;
        playerSubtitleView = null;
        seekFeedbackView = null;
        tvPlayerHud = null;
        tvBufferingSpinner = null;
        tvSeekBar = null;
        tvCurrentTimeView = null;
        tvTotalTimeView = null;
        tvClockView = null;
        tvFinishTimeView = null;
        tvStatusBadgesRow = null;
        tvBackButton = null;
        tvPlayPauseButton = null;
        tvPlayPauseIcon = null;
        tvPrevButton = null;
        tvRewindButton = null;
        tvForwardButton = null;
        tvNextButton = null;
        tvQueueButton = null;
        tvSpeedButton = null;
        tvTracksButton = null;
        tvAspectButton = null;
        tvRepeatButton = null;
        tvRepeatIcon = null;
        tvAutoplayButton = null;
        tvMoreButton = null;
        tvQueuePanel = null;
        tvQueueScroll = null;
        tvQueueRow = null;
        tvQueueHeading = null;
        tvSeekLeftOverlay = null;
        tvSeekLeftLabel = null;
        tvSeekRightOverlay = null;
        tvSeekRightLabel = null;
        tvCenterActionOverlay = null;
        tvCenterActionIcon = null;
        tvCenterActionLabel = null;
        tvMiniProgressContainer = null;
        tvMiniSeekBar = null;
        tvMiniTimeLabel = null;
        tvStatsOverlay = null;
        tvStatsBody = null;
        tvUpNextOverlay = null;
        tvUpNextCountdownLabel = null;
        tvUpNextTitleView = null;
        tvUpNextDurationView = null;
        tvUpNextPosterView = null;
        tvUpNextPlayNowBtn = null;
        tvUpNextCancelBtn = null;
        activeMediaDataSourceFactory = null;
        activeDirectMediaSourceFactory = null;
        tvHudVisible = false;
        tvQueueOpen = false;
        tvUpNextVisible = false;
        tvUpNextTargetIndex = -1;
        lastPlayerSeekAtMs = 0L;
        playerSeekStartedAtMs = 0L;
        quickSeekAccumulatedMs = 0L;
        quickSeekDirection = 0;
        scrubAccumulatedMs = 0L;
    }

    private void initDeviceIdentity() {
        android.content.SharedPreferences prefs = getPreferences(MODE_PRIVATE);
        vaultDeviceId = prefs.getString("vaultDeviceId", "").trim();
        if (vaultDeviceId.isEmpty()) {
            vaultDeviceId = UUID.randomUUID().toString();
            prefs.edit().putString("vaultDeviceId", vaultDeviceId).apply();
        }
        vaultDeviceName = prefs.getString("vaultDeviceName", "").trim();
        if (vaultDeviceName.isEmpty()) {
            vaultDeviceName = buildDefaultDeviceName();
            prefs.edit().putString("vaultDeviceName", vaultDeviceName).apply();
        }
    }

    private String buildDefaultDeviceName() {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();
        String combined;
        if (!manufacturer.isEmpty() && !model.isEmpty()) {
            if (model.toLowerCase(Locale.ROOT).startsWith(manufacturer.toLowerCase(Locale.ROOT))) {
                combined = model;
            } else {
                combined = Character.toUpperCase(manufacturer.charAt(0))
                    + manufacturer.substring(1) + " " + model;
            }
        } else if (!model.isEmpty()) {
            combined = model;
        } else {
            combined = isTvLayout() ? "Android TV" : "Android";
        }
        if (isTvLayout() && !combined.toLowerCase(Locale.ROOT).contains("tv")
            && !combined.toLowerCase(Locale.ROOT).contains("тв")) {
            return "ТВ · " + combined;
        }
        return combined;
    }

    private void startVaultWebSocket() {
        if (wsClient != null) {
            wsClient.stop();
        }
        String deviceType = isTvLayout() ? "tv" : "mobile";
        wsClient = new VaultWebSocketClient(
            apiClient,
            vaultDeviceId,
            vaultDeviceName,
            deviceType,
            new VaultWebSocketClient.Listener() {
                @Override
                public void onConnectionChanged(boolean connected) {
                    wsConnected = connected;
                    updateHeaderCastPill();
                    if (connected && isTvLayout()) {
                        if ("player".equals(page) && player != null && selectedVideo != null) {
                            reportTvPlayNow(selectedVideo, player.isPlaying() ? "playing" : "paused", true);
                        } else {
                            reportTvPlayNow(null, "stopped", true);
                        }
                    }
                }

                @Override
                public void onTvDevices(List<VaultWebSocketClient.TvDevice> devices) {
                    onlineTvDevices.clear();
                    onlineTvDevices.addAll(devices);
                    updateHeaderCastPill();
                }

                @Override
                public void onRemoteOpen(VaultWebSocketClient.RemoteOpenCommand command) {
                    handleRemoteOpenCommand(command);
                }

                @Override
                public void onLibraryEntry(JSONObject entryPayload) {
                    handleLiveLibraryEntryPayload(entryPayload);
                }

                @Override
                public void onLibraryRefresh() {
                    silentRefreshLibrary();
                }
            }
        );
        wsClient.start();
    }

    private void handleLiveLibraryEntryPayload(JSONObject payload) {
        try {
            String type = payload.optString("type", "");
            List<FileEntry> merged = new ArrayList<>();
            String toastHeading = "";
            String toastSub = "";
            if ("video".equals(type)) {
                JSONObject v = payload.optJSONObject("video");
                if (v == null) return;
                VideoFile video = parseVideo(v);
                merged.add(FileEntry.video(video));
                toastHeading = "Новое видео в библиотеке";
                toastSub = video.title;
            } else if ("folder".equals(type)) {
                JSONObject f = payload.optJSONObject("folder");
                if (f == null) return;
                SharedFolder folder = parseFolder(f);
                merged.add(FileEntry.folder(folder));
                toastHeading = "Обновлена папка";
                toastSub = folder.name;
            } else if ("file".equals(type)) {
                JSONObject f = payload.optJSONObject("file");
                if (f == null) return;
                FileEntry entry = FileEntry.file(f);
                if (entry.fileId.isEmpty()) return;
                merged.add(entry);
                toastHeading = "Добавлен новый файл";
                toastSub = entry.fileName;
            }
            if (merged.isEmpty()) return;
            repository.mergeFileEntries(merged);
            invalidateDirectoryEntries();
            if (!"player".equals(page) && !isLoading) {
                render();
            }
            if (!toastHeading.isEmpty()) {
                showCastBanner(toastHeading, toastSub, false);
            }
        } catch (Exception ignored) {
            // Ignore malformed live update entry.
        }
    }

    private void silentRefreshLibrary() {
        new Thread(() -> {
            try {
                JSONArray folderPayload = apiClient.getArray("/folders");
                JSONArray videoPayload = apiClient.getArray("/videos");
                List<SharedFolder> nextFolders = parseFolders(folderPayload);
                List<VideoFile> nextVideos = parseVideos(videoPayload);
                runOnUiThread(() -> {
                    repository.replaceData(nextFolders, nextVideos);
                    invalidateDirectoryEntries();
                    if (!"player".equals(page)) {
                        render();
                    }
                });
            } catch (Exception ignored) {
                // Silent background refresh should never disrupt active viewing.
            }
        }).start();
    }

    private void handleRemoteOpenCommand(VaultWebSocketClient.RemoteOpenCommand cmd) {
        if (cmd == null) return;
        if (!cmd.deviceId.isEmpty() && !cmd.deviceId.equals(vaultDeviceId)) {
            return;
        }
        final String sender = (cmd.senderName != null && !cmd.senderName.trim().isEmpty())
            ? cmd.senderName.trim()
            : "Удалённое устройство";
        lastCastSenderName = sender;

        if ("stop".equalsIgnoreCase(cmd.mode)) {
            castSenderName = "";
            isRemoteQueueActive = false;
            locallyStartedVideoId = "";
            if ("player".equals(page)) {
                pendingCastToastTitle = "Остановлено с «" + sender + "»";
                pendingCastToastSubtitle = "Воспроизведение завершено";
                closePlayer();
            } else {
                updateHeaderCastPill();
                showCastBanner("Остановлено с «" + sender + "»", "Воспроизведение завершено", true);
            }
            return;
        }

        if (cmd.entries == null || cmd.entries.isEmpty()) {
            if ("sync".equalsIgnoreCase(cmd.mode) && "player".equals(page)) {
                // If user started the current video locally on TV, NEVER stop it when remote queue is cleared!
                if (player != null && selectedVideo != null && selectedVideo.id.equals(locallyStartedVideoId)) {
                    int currentExoIdx = player.getCurrentMediaItemIndex();
                    int totalExoCount = player.getMediaItemCount();
                    if (currentExoIdx + 1 < totalExoCount) {
                        player.removeMediaItems(currentExoIdx + 1, totalExoCount);
                    }
                    if (currentExoIdx > 0) {
                        player.removeMediaItems(0, currentExoIdx);
                    }
                    playbackQueue.clear();
                    playbackQueue.add(selectedVideo);
                    playbackIndex = 0;
                    isRemoteQueueActive = false;
                    castSenderName = "";
                    updatePlayerMetadata();
                    if (isTvLayout()) {
                        rebuildTvQueueCards();
                        updateTvControlStates();
                    }
                    showCastBanner("«" + sender + "» очистил очередь далее", "Текущее видео продолжает играть", true);
                    return;
                }
                castSenderName = "";
                isRemoteQueueActive = false;
                pendingCastToastTitle = "Очередь очищена · " + sender;
                pendingCastToastSubtitle = "";
                closePlayer();
            }
            return;
        }

        new Thread(() -> {
            List<VideoFile> resolved = new ArrayList<>();
            for (VaultWebSocketClient.RemoteEntry entry : cmd.entries) {
                VideoFile video = resolveRemoteEntry(entry);
                if (video != null) {
                    resolved.add(video);
                }
            }
            if (resolved.isEmpty()) {
                return;
            }
            runOnUiThread(() -> applyResolvedRemoteCommand(cmd.mode, resolved, sender));
        }).start();
    }

    private VideoFile resolveRemoteEntry(VaultWebSocketClient.RemoteEntry entry) {
        if (entry == null || entry.id == null || entry.id.isEmpty()) {
            return null;
        }
        if ("audio".equalsIgnoreCase(entry.type) || "file".equalsIgnoreCase(entry.type)) {
            String streamUrl = apiClient.absoluteUrl("/files/" + Uri.encode(entry.id) + "/download");
            return new VideoFile(
                entry.id,
                "Аудиофайл",
                "",
                "Аудио",
                "",
                "",
                0L,
                "",
                "",
                "AUDIO",
                "",
                "",
                streamUrl,
                "",
                "mp3"
            );
        }
        VideoFile cached = repository.findVideoById(entry.id);
        if (cached != null) {
            return cached;
        }
        try {
            JSONObject obj = apiClient.getObject("/videos/" + Uri.encode(entry.id));
            VideoFile fetched = parseVideo(obj);
            List<FileEntry> single = new ArrayList<>();
            single.add(FileEntry.video(fetched));
            repository.mergeFileEntries(single);
            return fetched;
        } catch (Exception ignored) {
            // Fallback: build direct streamable VideoFile if metadata endpoint is unavailable
            String streamUrl = apiClient.absoluteUrl("/videos/" + Uri.encode(entry.id) + "/stream");
            String posterUrl = apiClient.absoluteUrl("/videos/" + Uri.encode(entry.id) + "/poster");
            return new VideoFile(
                entry.id,
                "Видео с сервера",
                "",
                "",
                "",
                "",
                0L,
                "",
                "",
                "",
                "",
                posterUrl,
                streamUrl,
                "",
                ""
            );
        }
    }

    private MediaSource buildMediaSourceForVideo(VideoFile video) {
        if (activeMediaDataSourceFactory == null || activeDirectMediaSourceFactory == null) {
            OkHttpDataSource.Factory httpFactory = new OkHttpDataSource.Factory(apiClient.client())
                .setUserAgent("LocalVideoVaultMobile/1.0");
            activeMediaDataSourceFactory = new DefaultDataSource.Factory(this, httpFactory);
            activeDirectMediaSourceFactory = new DefaultMediaSourceFactory(activeMediaDataSourceFactory);
        }
        if (video.usesHls()) {
            String url = apiClient.absoluteUrl("/videos/" + Uri.encode(video.id) + "/hls/master.m3u8");
            MediaItem item = new MediaItem.Builder()
                .setMediaId(video.id)
                .setUri(url)
                .setMimeType(MimeTypes.APPLICATION_M3U8)
                .build();
            return new HlsMediaSource.Factory(activeMediaDataSourceFactory)
                .setPlaylistParserFactory(new VaultHlsPlaylistParser(apiClient, video.id))
                .createMediaSource(item);
        }
        return activeDirectMediaSourceFactory.createMediaSource(
            new MediaItem.Builder().setMediaId(video.id).setUri(video.streamUrl).build()
        );
    }

    private void applyResolvedRemoteCommand(String mode, List<VideoFile> resolved, String sender) {
        String firstTitle = resolved.get(0).title;

        if ("append".equalsIgnoreCase(mode)) {
            if ("player".equals(page) && player != null && selectedVideo != null) {
                boolean wasLocalFolderQueue = !isRemoteQueueActive;
                if (wasLocalFolderQueue) {
                    // TV was playing a video started locally: keep it playing uninterrupted,
                    // replace the auto-generated folder tail after current video with the appended remote items!
                    int currentExoIdx = player.getCurrentMediaItemIndex();
                    int totalExoCount = player.getMediaItemCount();
                    if (currentExoIdx + 1 < totalExoCount) {
                        player.removeMediaItems(currentExoIdx + 1, totalExoCount);
                    }
                    while (playbackQueue.size() > playbackIndex + 1) {
                        playbackQueue.remove(playbackQueue.size() - 1);
                    }
                    isRemoteQueueActive = true;
                }

                List<VideoFile> additions = new ArrayList<>();
                for (VideoFile candidate : resolved) {
                    boolean existsInUpcoming = false;
                    int checkStart = Math.max(0, playbackIndex);
                    for (int i = checkStart; i < playbackQueue.size(); i++) {
                        if (playbackQueue.get(i).id.equals(candidate.id)) {
                            existsInUpcoming = true;
                            break;
                        }
                    }
                    if (!existsInUpcoming) {
                        additions.add(candidate);
                    }
                }
                if (!additions.isEmpty()) {
                    List<MediaSource> addedSources = new ArrayList<>();
                    for (VideoFile v : additions) {
                        playbackQueue.add(v);
                        addedSources.add(buildMediaSourceForVideo(v));
                    }
                    player.addMediaSources(addedSources);
                    updatePlayerMetadata();
                    if (isTvLayout()) {
                        rebuildTvQueueCards();
                        updateTvControlStates();
                    }
                    String sub = additions.size() == 1
                        ? additions.get(0).title
                        : additions.get(0).title + " (+" + (additions.size() - 1) + ")";
                    showCastBanner("«" + sender + "» добавил далее в очередь", sub, true);
                }
                return;
            }
            // Player is not open yet — open immediately with appended items
            castSenderName = sender;
            isRemoteQueueActive = true;
            locallyStartedVideoId = "";
            updateHeaderCastPill();
            launchRemotePlayerQueue(
                resolved,
                "Отправлено с «" + sender + "»",
                resolved.size() == 1 ? firstTitle : firstTitle + " · плейлист (" + resolved.size() + ")"
            );
            return;
        }

        if ("sync".equalsIgnoreCase(mode)) {
            if ("player".equals(page) && player != null && selectedVideo != null) {
                int keepIndex = -1;
                for (int i = 0; i < resolved.size(); i++) {
                    if (resolved.get(i).id.equals(selectedVideo.id)) {
                        keepIndex = i;
                        break;
                    }
                }
                int currentExoIdx = player.getCurrentMediaItemIndex();
                int totalExoCount = player.getMediaItemCount();
                if (keepIndex >= 0) {
                    // Seamlessly update items before & after current playing video without interrupting playback
                    if (currentExoIdx + 1 < totalExoCount) {
                        player.removeMediaItems(currentExoIdx + 1, totalExoCount);
                    }
                    if (currentExoIdx > 0) {
                        player.removeMediaItems(0, currentExoIdx);
                    }
                    List<MediaSource> beforeSources = new ArrayList<>();
                    for (int i = 0; i < keepIndex; i++) {
                        beforeSources.add(buildMediaSourceForVideo(resolved.get(i)));
                    }
                    List<MediaSource> afterSources = new ArrayList<>();
                    for (int i = keepIndex + 1; i < resolved.size(); i++) {
                        afterSources.add(buildMediaSourceForVideo(resolved.get(i)));
                    }
                    if (!beforeSources.isEmpty()) {
                        player.addMediaSources(0, beforeSources);
                    }
                    if (!afterSources.isEmpty()) {
                        player.addMediaSources(afterSources);
                    }
                    playbackQueue.clear();
                    playbackQueue.addAll(resolved);
                    playbackIndex = keepIndex;
                    isRemoteQueueActive = true;
                    updatePlayerMetadata();
                    if (isTvLayout()) {
                        rebuildTvQueueCards();
                        updateTvControlStates();
                    }
                    showCastBanner("«" + sender + "» обновил плейлист", "В очереди: " + resolved.size() + " видео", true);
                    return;
                }
                // Current video was started locally on TV and isn't in the remote queue:
                // keep it playing seamlessly at index 0 and place the synced queue right after it!
                if (selectedVideo.id.equals(locallyStartedVideoId)) {
                    if (currentExoIdx + 1 < totalExoCount) {
                        player.removeMediaItems(currentExoIdx + 1, totalExoCount);
                    }
                    if (currentExoIdx > 0) {
                        player.removeMediaItems(0, currentExoIdx);
                    }
                    List<MediaSource> afterSources = new ArrayList<>();
                    for (VideoFile v : resolved) {
                        afterSources.add(buildMediaSourceForVideo(v));
                    }
                    if (!afterSources.isEmpty()) {
                        player.addMediaSources(afterSources);
                    }
                    playbackQueue.clear();
                    playbackQueue.add(selectedVideo);
                    playbackQueue.addAll(resolved);
                    playbackIndex = 0;
                    isRemoteQueueActive = true;
                    updatePlayerMetadata();
                    if (isTvLayout()) {
                        rebuildTvQueueCards();
                        updateTvControlStates();
                    }
                    showCastBanner("«" + sender + "» обновил очередь далее", "Далее видео: " + resolved.size(), true);
                    return;
                }
            }
            // Current remote video was removed or player wasn't open -> play synced queue from start
            castSenderName = sender;
            isRemoteQueueActive = true;
            locallyStartedVideoId = "";
            updateHeaderCastPill();
            launchRemotePlayerQueue(
                resolved,
                "Плейлист от «" + sender + "»",
                resolved.size() == 1 ? firstTitle : firstTitle + " · всего " + resolved.size()
            );
            return;
        }

        // Default mode: "replace" — explicit launch from Play button or clicking a playlist row
        castSenderName = sender;
        isRemoteQueueActive = true;
        locallyStartedVideoId = "";
        updateHeaderCastPill();
        if ("player".equals(page) && player != null) {
            saveCurrentVideoProgress(true);
            dismissUpNextOverlay(false);
            playbackQueue.clear();
            playbackQueue.addAll(resolved);
            playbackIndex = 0;
            selectedVideo = resolved.get(0);
            returnFocusedVideoId = selectedVideo.id;
            List<MediaSource> sources = new ArrayList<>();
            for (VideoFile v : playbackQueue) {
                sources.add(buildMediaSourceForVideo(v));
            }
            long resumePos = getSavedVideoPosition(selectedVideo.id);
            player.setMediaSources(sources, 0, resumePos);
            player.prepare();
            player.play();
            updatePlayerMetadata();
            if (isTvLayout()) {
                rebuildTvQueueCards();
                updateTvControlStates();
                updateTvPlayerProgressUi();
                setTvHudVisible(true, tvPlayPauseButton);
                reportTvPlayNow(selectedVideo, "playing", true);
            }
            showCastBanner(
                "Отправлено с «" + sender + "»",
                resolved.size() == 1 ? firstTitle : firstTitle + " · плейлист (" + resolved.size() + ")",
                true
            );
            return;
        }

        launchRemotePlayerQueue(
            resolved,
            "Отправлено с «" + sender + "»",
            resolved.size() == 1 ? firstTitle : firstTitle + " · плейлист (" + resolved.size() + ")"
        );
    }

    private void reportTvPlayNow(VideoFile video, String status, boolean force) {
        if (!isTvLayout() || apiClient == null || vaultDeviceId == null || vaultDeviceId.isEmpty()) {
            return;
        }
        final boolean isStopped = video == null || "stopped".equals(status);
        final String videoId = isStopped ? "" : (video.id == null ? "" : video.id);
        final String entryType = isStopped ? "" : ("AUDIO".equalsIgnoreCase(video.codec) ? "audio" : "video");
        final String title = isStopped ? "" : (video.title == null ? "" : video.title);
        final boolean isPlaying = !isStopped && "playing".equals(status);
        final String source = isStopped
            ? ""
            : (!videoId.isEmpty() && videoId.equals(locallyStartedVideoId) ? "local" : "remote");
        final String stateKey = videoId + "|" + status + "|" + source;
        if (!force && stateKey.equals(lastReportedPlayNowKey)) {
            return;
        }
        lastReportedPlayNowKey = stateKey;

        new Thread(() -> {
            try {
                JSONObject entryObj = new JSONObject()
                    .put("id", videoId)
                    .put("type", entryType);
                JSONArray entriesArr = new JSONArray();
                if (!isStopped && !videoId.isEmpty()) {
                    entriesArr.put(entryObj);
                }
                JSONObject payload = new JSONObject()
                    .put("deviceId", vaultDeviceId)
                    .put("deviceName", vaultDeviceName)
                    .put("entry", entryObj)
                    .put("entries", entriesArr)
                    .put("id", videoId)
                    .put("videoId", videoId)
                    .put("entryId", videoId)
                    .put("type", entryType)
                    .put("title", title)
                    .put("playing", isPlaying)
                    .put("isPlaying", isPlaying)
                    .put("status", isStopped ? "stopped" : status)
                    .put("source", source);
                apiClient.postJson("/tv/play/now", payload);
            } catch (Exception ignored) {
                // Reporting TV now-playing state is best-effort and never interrupts playback.
            }
        }).start();
    }

    private void launchRemotePlayerQueue(List<VideoFile> queue, String bannerTitle, String bannerSub) {
        playerReturnPage = "player".equals(page) ? "videos" : page;
        returnFocusedVideoId = queue.get(0).id;
        returnScrollY = mainScrollView == null ? 0 : mainScrollView.getScrollY();
        shouldRestoreListPosition = false;
        playbackQueue.clear();
        playbackQueue.addAll(queue);
        playbackIndex = 0;
        selectedVideo = queue.get(0);
        pendingCastToastTitle = bannerTitle;
        pendingCastToastSubtitle = bannerSub;
        page = "player";
        render();
    }

    private void attachCastToastBanner(FrameLayout host) {
        if (host == null) return;
        LinearLayout banner = new LinearLayout(this);
        banner.setOrientation(LinearLayout.HORIZONTAL);
        banner.setGravity(Gravity.CENTER_VERTICAL);
        banner.setPadding(dp(14), dp(12), dp(20), dp(12));
        banner.setBackground(makeMaterialSurfaceDrawable(Color.argb(242, 23, 25, 32), ACCENT, 20, 1));
        banner.setElevation(dp(28));
        banner.setVisibility(View.GONE);
        banner.setFocusable(false);
        banner.setClickable(false);

        FrameLayout iconWrap = new FrameLayout(this);
        iconWrap.setBackground(makeMaterialSurfaceDrawable(ACCENT_SOFT, 0, 999, 0));
        castToastIcon = new ImageView(this);
        castToastIcon.setImageResource(R.drawable.ic_cast_connected_tv);
        castToastIcon.setColorFilter(ACCENT);
        castToastIcon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        iconWrap.addView(castToastIcon, new FrameLayout.LayoutParams(dp(20), dp(20), Gravity.CENTER));
        banner.addView(iconWrap, new LinearLayout.LayoutParams(dp(40), dp(40)));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.setPadding(dp(14), 0, 0, 0);
        castToastTitle = text("", 14, Color.WHITE, true);
        castToastTitle.setMaxLines(1);
        castToastTitle.setEllipsize(TextUtils.TruncateAt.END);
        castToastSubtitle = text("", 12, ACCENT_LIGHT, false);
        castToastSubtitle.setMaxLines(1);
        castToastSubtitle.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(-2, -2);
        subLp.topMargin = dp(2);
        copy.addView(castToastTitle);
        copy.addView(castToastSubtitle, subLp);
        banner.addView(copy, new LinearLayout.LayoutParams(-2, -2));

        castToastBanner = banner;
        int maxW = Math.min(dp(560), getResources().getDisplayMetrics().widthPixels - dp(48));
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        params.topMargin = dp(isTvLayout() ? 24 : 16);
        banner.setMinimumWidth(dp(260));
        castToastTitle.setMaxWidth(maxW - dp(96));
        castToastSubtitle.setMaxWidth(maxW - dp(96));
        host.addView(banner, params);
    }

    private void flushPendingCastToast() {
        if (pendingCastToastTitle != null && !pendingCastToastTitle.isEmpty()) {
            String t = pendingCastToastTitle;
            String s = pendingCastToastSubtitle;
            pendingCastToastTitle = "";
            pendingCastToastSubtitle = "";
            showCastBanner(t, s, true);
        }
    }

    private void showCastBanner(String title, String subtitle, boolean isCastEvent) {
        if (castToastBanner == null || castToastTitle == null || castToastSubtitle == null) {
            return;
        }
        castToastBanner.removeCallbacks(hideCastToastBanner);
        castToastBanner.animate().cancel();
        if (castToastIcon != null) {
            castToastIcon.setImageResource(isCastEvent ? R.drawable.ic_cast_connected_tv : R.drawable.ic_video_tv);
        }
        castToastTitle.setText(title == null ? "" : title);
        boolean hasSub = subtitle != null && !subtitle.trim().isEmpty();
        castToastSubtitle.setText(hasSub ? subtitle.trim() : "");
        castToastSubtitle.setVisibility(hasSub ? View.VISIBLE : View.GONE);

        castToastBanner.setVisibility(View.VISIBLE);
        castToastBanner.setAlpha(0f);
        castToastBanner.setTranslationY(-dp(20));
        castToastBanner.animate()
            .alpha(1f)
            .translationY(0f)
            .setDuration(220L)
            .start();
        castToastBanner.postDelayed(hideCastToastBanner, 4_500L);
    }

    private LinearLayout buildHeaderCastPill() {
        LinearLayout pill = new LinearLayout(this);
        pill.setOrientation(LinearLayout.HORIZONTAL);
        pill.setGravity(Gravity.CENTER_VERTICAL);
        pill.setPadding(dp(14), 0, dp(16), 0);
        pill.setFocusable(true);
        pill.setFocusableInTouchMode(isTvLayout());
        pill.setClickable(true);
        pill.setClipChildren(false);
        pill.setClipToPadding(false);

        View dot = new View(this);
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(8), dp(8));
        dotLp.rightMargin = dp(8);
        pill.addView(dot, dotLp);

        ImageView icon = new ImageView(this);
        icon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        LinearLayout.LayoutParams iconLp = new LinearLayout.LayoutParams(dp(17), dp(17));
        iconLp.rightMargin = dp(8);
        pill.addView(icon, iconLp);

        TextView label = text("", 13, TEXT, true);
        label.setMaxLines(1);
        label.setEllipsize(TextUtils.TruncateAt.END);
        label.setMaxWidth(dp(isTvLayout() ? 220 : 140));
        pill.addView(label);

        headerCastPill = pill;
        headerCastDot = dot;
        headerCastIcon = icon;
        headerCastLabel = label;

        pill.setOnFocusChangeListener((v, hasFocus) -> {
            if (hasFocus) {
                allowFocusOverflow(v, null);
            }
            v.animate().cancel();
            v.animate()
                .scaleX(hasFocus ? 1.03f : 1f)
                .scaleY(hasFocus ? 1.03f : 1f)
                .setDuration(hasFocus ? 130L : 90L)
                .start();
            v.setElevation(hasFocus ? dp(10) : 0);
            styleHeaderCastPill(hasFocus);
        });
        pill.setOnClickListener(v -> showCastStatusDialog());
        updateHeaderCastPill();
        return pill;
    }

    private void updateHeaderCastPill() {
        if (headerCastPill == null || headerCastLabel == null || headerCastIcon == null || headerCastDot == null) {
            return;
        }
        styleHeaderCastPill(headerCastPill.hasFocus());
    }

    private void styleHeaderCastPill(boolean hasFocus) {
        if (headerCastPill == null || headerCastLabel == null || headerCastIcon == null || headerCastDot == null) {
            return;
        }
        List<VaultWebSocketClient.TvDevice> targets = getCastTargetDevices();
        boolean activeCast = !castSenderName.isEmpty() || (!isTvLayout() && !targets.isEmpty());
        String textLabel;
        if (isTvLayout()) {
            if (!castSenderName.isEmpty()) {
                textLabel = "От: " + castSenderName;
            } else if (wsConnected) {
                textLabel = vaultDeviceName;
            } else {
                textLabel = "Подключение…";
            }
        } else {
            VaultWebSocketClient.TvDevice selected = findSelectedCastTv();
            if (selected != null) {
                textLabel = selected.name;
            } else if (!targets.isEmpty()) {
                textLabel = "ТВ · " + targets.size();
            } else {
                textLabel = "ТВ";
            }
        }

        int bg = hasFocus ? ACCENT : (activeCast ? ACCENT_SOFT : CARD);
        int fg = hasFocus ? DARK : (activeCast ? ACCENT_LIGHT : TEXT);
        int dotColor = hasFocus
            ? DARK
            : (wsConnected
                ? (activeCast ? ACCENT : Color.rgb(34, 197, 94))
                : Color.rgb(120, 128, 142));

        headerCastPill.setBackground(makeMaterialSurfaceDrawable(bg, 0, 999, 0));
        headerCastDot.setBackground(makeMaterialSurfaceDrawable(dotColor, 0, 999, 0));
        headerCastIcon.setImageResource(activeCast ? R.drawable.ic_cast_connected_tv : R.drawable.ic_cast_tv);
        headerCastIcon.setColorFilter(hasFocus ? DARK : (activeCast ? ACCENT : MUTED));
        headerCastLabel.setText(textLabel);
        headerCastLabel.setTextColor(fg);
    }

    private List<VaultWebSocketClient.TvDevice> getCastTargetDevices() {
        List<VaultWebSocketClient.TvDevice> result = new ArrayList<>();
        for (VaultWebSocketClient.TvDevice dev : onlineTvDevices) {
            if (!dev.id.equals(vaultDeviceId)) {
                result.add(dev);
            }
        }
        return result;
    }

    private VaultWebSocketClient.TvDevice findSelectedCastTv() {
        List<VaultWebSocketClient.TvDevice> targets = getCastTargetDevices();
        for (VaultWebSocketClient.TvDevice dev : targets) {
            if (dev.id.equals(selectedCastTvId)) {
                return dev;
            }
        }
        return targets.size() == 1 ? targets.get(0) : null;
    }

    private void showCastStatusDialog() {
        List<VaultWebSocketClient.TvDevice> targets = getCastTargetDevices();
        List<String> items = new ArrayList<>();
        List<Runnable> actions = new ArrayList<>();

        String statusLine = wsConnected
            ? "В сети как «" + vaultDeviceName + "»"
            : "Подключение к WebSocket серверу…";
        items.add(statusLine);
        actions.add(() -> {});

        if (!lastCastSenderName.isEmpty()) {
            items.add("Последнее устройство: " + lastCastSenderName);
            actions.add(() -> {});
        }

        items.add("Переименовать это устройство");
        actions.add(this::showRenameDeviceDialog);

        if (!wsConnected && wsClient != null) {
            items.add("Переподключиться к серверу");
            actions.add(() -> wsClient.reconnect(vaultDeviceName));
        }

        for (VaultWebSocketClient.TvDevice tv : targets) {
            boolean selected = tv.id.equals(selectedCastTvId);
            items.add((selected ? "✓ " : "📺 ") + tv.name + "  (Остановить / Выбрать)");
            actions.add(() -> showRemoteTvActionsDialog(tv));
        }

        new MaterialAlertDialogBuilder(this)
            .setTitle(isTvLayout() ? "ТВ-приёмник и сеть" : "Подключение к ТВ")
            .setItems(items.toArray(new String[0]), (d, which) -> actions.get(which).run())
            .setNegativeButton("Закрыть", null)
            .show();
    }

    private void showRenameDeviceDialog() {
        EditText nameInput = input("Название устройства", vaultDeviceName);
        new MaterialAlertDialogBuilder(this)
            .setTitle("Название устройства в сети")
            .setView(nameInput)
            .setNegativeButton("Отмена", null)
            .setPositiveButton("Сохранить", (d, w) -> {
                String next = nameInput.getText().toString().trim();
                if (next.isEmpty()) return;
                vaultDeviceName = next;
                getPreferences(MODE_PRIVATE).edit().putString("vaultDeviceName", vaultDeviceName).apply();
                if (wsClient != null) {
                    wsClient.reconnect(vaultDeviceName);
                }
                updateHeaderCastPill();
                showCastBanner("Имя устройства обновлено", vaultDeviceName, false);
            })
            .show();
    }

    private void showRemoteTvActionsDialog(VaultWebSocketClient.TvDevice tv) {
        String[] options = {"Выбрать этот ТВ по умолчанию", "Остановить воспроизведение на ТВ"};
        new MaterialAlertDialogBuilder(this)
            .setTitle(tv.name)
            .setItems(options, (d, which) -> {
                if (which == 0) {
                    selectedCastTvId = tv.id;
                    getPreferences(MODE_PRIVATE).edit().putString("selectedCastTvId", selectedCastTvId).apply();
                    updateHeaderCastPill();
                    showCastBanner("Выбран телевизор", tv.name, true);
                } else {
                    sendCastCommandToTv(tv, "stop", Collections.emptyList());
                }
            })
            .setNegativeButton("Отмена", null)
            .show();
    }

    private void showCastVideoPicker(VideoFile video, String mode) {
        List<VaultWebSocketClient.TvDevice> targets = getCastTargetDevices();
        if (targets.isEmpty()) {
            toastDialog("Телевизоры не найдены", "Откройте Video Vault на телевизоре — устройство появится автоматически.");
            return;
        }
        if (targets.size() == 1) {
            sendCastCommandToTv(targets.get(0), mode, Collections.singletonList(video));
            return;
        }
        String[] names = new String[targets.size()];
        for (int i = 0; i < targets.size(); i++) {
            names[i] = targets.get(i).name;
        }
        new MaterialAlertDialogBuilder(this)
            .setTitle("append".equals(mode) ? "Добавить в очередь на ТВ" : "Отправить на телевизор")
            .setItems(names, (d, which) -> sendCastCommandToTv(targets.get(which), mode, Collections.singletonList(video)))
            .setNegativeButton("Отмена", null)
            .show();
    }

    private void sendCastCommandToTv(VaultWebSocketClient.TvDevice tv, String mode, List<VideoFile> videos) {
        selectedCastTvId = tv.id;
        getPreferences(MODE_PRIVATE).edit().putString("selectedCastTvId", selectedCastTvId).apply();
        updateHeaderCastPill();

        new Thread(() -> {
            try {
                JSONArray entries = new JSONArray();
                for (VideoFile v : videos) {
                    entries.put(new JSONObject().put("id", v.id).put("type", "video"));
                }
                JSONObject payload = new JSONObject()
                    .put("deviceId", tv.id)
                    .put("mode", mode)
                    .put("entries", entries)
                    .put("fromDeviceId", vaultDeviceId)
                    .put("fromDeviceName", vaultDeviceName)
                    .put("senderName", vaultDeviceName);
                apiClient.postJson("/tv/open", payload);
                runOnUiThread(() -> {
                    if ("stop".equals(mode)) {
                        showCastBanner("Остановлено на «" + tv.name + "»", "", true);
                    } else if ("append".equals(mode)) {
                        showCastBanner("Добавлено в очередь «" + tv.name + "»", videos.isEmpty() ? "" : videos.get(0).title, true);
                    } else {
                        showCastBanner("Отправлено на «" + tv.name + "»", videos.isEmpty() ? "" : videos.get(0).title, true);
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> toastDialog("Ошибка отправки на ТВ", safeText(error.getMessage())));
            }
        }).start();
    }
}

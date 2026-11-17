package app.stak.builder;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StakNativePlugin.class);
        super.onCreate(savedInstanceState);
        fitSystemBars();
        // Hardware back: walk the web app's history first, then leave the app in the background like native apps do.
        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (getBridge() != null && getBridge().getWebView().canGoBack()) getBridge().getWebView().goBack();
                else moveTaskToBack(true);
            }
        });
        Notifier.channels(this);
        if (Store.signedIn(this)) SyncWorker.schedule(this);
        openProject(getIntent(), savedInstanceState == null ? 1800 : 0);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openProject(intent, 0);
    }

    @Override public void onResume() {
        super.onResume();
        if (Sync.building(Store.summary(this))) LiveService.start(this);
    }

    /**
     * Android 15 forces edge-to-edge, which pushed the web UI under the status/navigation bars.
     * Pad the WebView container by the system-bar, cutout and keyboard insets and paint the bars to match the theme.
     */
    private void fitSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View root = (View) getBridge().getWebView().getParent();
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        boolean dark = Store.prefs(this).getBoolean("dark", true);
        applyChrome(dark, Store.prefs(this).getInt("barColor", dark ? 0xFF121110 : 0xFFFBFAF9));
        ViewCompat.requestApplyInsets(root);
    }

    /** Called from the web app (StakNative.setChrome) whenever the theme changes. */
    void applyChrome(boolean dark, int color) {
        runOnUiThread(() -> {
            View root = (View) getBridge().getWebView().getParent();
            root.setBackgroundColor(color);
            getBridge().getWebView().setBackgroundColor(color);
            getWindow().getDecorView().setBackgroundColor(color);
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            c.setAppearanceLightStatusBars(!dark);
            c.setAppearanceLightNavigationBars(!dark);
            if (android.os.Build.VERSION.SDK_INT < 35) { getWindow().setStatusBarColor(color); getWindow().setNavigationBarColor(color); }
        });
    }

    /** Notification / widget taps carry a projectId — jump straight to that workspace. */
    private void openProject(Intent i, long delay) {
        String pid = i == null ? null : i.getStringExtra("projectId");
        if (pid == null || pid.isEmpty() || !pid.matches("[A-Za-z0-9_-]{4,64}") || getBridge() == null) return;
        i.removeExtra("projectId");
        String js = "location.hash='#/p/" + pid + "'";
        getBridge().getWebView().postDelayed(() -> getBridge().getWebView().evaluateJavascript(js, null), delay);
    }
}

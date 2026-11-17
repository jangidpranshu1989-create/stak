package app.stak.builder;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StakNativePlugin.class);
        super.onCreate(savedInstanceState);
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

    /** Notification / widget taps carry a projectId — jump straight to that workspace. */
    private void openProject(Intent i, long delay) {
        String pid = i == null ? null : i.getStringExtra("projectId");
        if (pid == null || pid.isEmpty() || !pid.matches("[A-Za-z0-9_-]{4,64}") || getBridge() == null) return;
        i.removeExtra("projectId");
        String js = "location.hash='#/p/" + pid + "'";
        getBridge().getWebView().postDelayed(() -> getBridge().getWebView().evaluateJavascript(js, null), delay);
    }
}

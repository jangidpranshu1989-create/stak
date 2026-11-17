package app.stak.builder;

import android.Manifest;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** JS bridge used by stak.pplx.app when it runs inside the Android app (window.Capacitor.Plugins.StakNative). */
@CapacitorPlugin(name = "StakNative", permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) })
public class StakNativePlugin extends Plugin {

    @PluginMethod public void setSession(PluginCall call) {
        String token = call.getString("token", "");
        Store.setSession(getContext(), token, call.getString("api"));
        if (token.isEmpty()) SyncWorker.cancel(getContext()); else { SyncWorker.schedule(getContext()); SyncWorker.now(getContext()); }
        StakWidget.updateAll(getContext());
        call.resolve();
    }

    @PluginMethod public void update(PluginCall call) {
        String s = call.getString("summary");
        if (s != null && Store.signedIn(getContext())) { Store.saveSummary(getContext(), s); StakWidget.updateAll(getContext()); }
        call.resolve();
    }

    @PluginMethod public void startLive(PluginCall call) { LiveService.start(getContext()); call.resolve(); }

    @PluginMethod public void notify(PluginCall call) {
        Notifier.post(getContext(), call.getString("title", "Stak"), call.getString("body", ""), call.getString("projectId", ""), (int) (System.currentTimeMillis() % 100000));
        call.resolve();
    }

    @PluginMethod public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("signedIn", Store.signedIn(getContext()));
        r.put("notifications", Notifier.allowed(getContext()));
        r.put("lastSync", Store.summaryAt(getContext()));
        call.resolve(r);
    }

    @Override @PluginMethod public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) { done(call); return; }
        requestPermissionForAlias("notifications", call, "permCallback");
    }

    @PermissionCallback private void permCallback(PluginCall call) { done(call); }

    private void done(PluginCall call) {
        Notifier.channels(getContext());
        JSObject r = new JSObject();
        r.put("notifications", Notifier.allowed(getContext()) ? "granted" : "denied");
        call.resolve(r);
    }
}

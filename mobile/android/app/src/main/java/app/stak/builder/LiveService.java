package app.stak.builder;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/** Foreground "live tracking" while a build runs: polls every 3 s, updates the ongoing notification + widget. */
public class LiveService extends Service {
    private volatile boolean running;
    private Thread worker;

    static void start(Context c) {
        if (!Store.signedIn(c)) return;
        try { ContextCompat.startForegroundService(c, new Intent(c, LiveService.class)); } catch (Exception ignored) { /* background start not allowed — WorkManager covers it */ }
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        Notifier.channels(this);
        Notification n = ongoing(null);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(Notifier.LIVE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(Notifier.LIVE_ID, n);
        } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
        if (!running) {
            running = true;
            worker = new Thread(this::loop, "stak-live");
            worker.start();
        }
        return START_NOT_STICKY;
    }

    private void loop() {
        int idle = 0, fails = 0;
        long started = System.currentTimeMillis();
        while (running && System.currentTimeMillis() - started < 45 * 60_000L) {
            JSONObject s = Sync.run(this);
            if (s == null) { if (++fails > 20) break; }
            else {
                fails = 0;
                if (Sync.building(s)) { idle = 0; show(s); }
                else if (++idle >= 2) break;
            }
            try { Thread.sleep(3000); } catch (InterruptedException e) { break; }
        }
        running = false;
        stopForeground(true);
        stopSelf();
    }

    private void show(JSONObject s) {
        try { NotificationManagerCompat.from(this).notify(Notifier.LIVE_ID, ongoing(s)); } catch (SecurityException ignored) {}
    }

    private Notification ongoing(JSONObject s) {
        String title = "Stak is building", text = "Connecting…";
        int pct = 0; boolean indet = true; String pid = null;
        JSONArray a = s == null ? null : s.optJSONArray("active");
        if (a != null && a.length() > 0) {
            JSONObject j = a.optJSONObject(0);
            title = j.optString("title", "Project");
            pct = (int) Math.round(j.optDouble("progress", 0) * 100);
            indet = pct <= 0;
            pid = j.optString("projectId");
            text = Phases.label(j.optString("phase")) + " · " + pct + "% · " + Phases.clock(j.optLong("elapsed")) + (a.length() > 1 ? " · +" + (a.length() - 1) + " more" : "");
        }
        return new NotificationCompat.Builder(this, Notifier.CH_LIVE)
                .setSmallIcon(R.drawable.ic_stat_stak)
                .setColor(0xFFF26B1D)
                .setContentTitle(title)
                .setContentText(text)
                .setSubText("Live")
                .setProgress(100, pct, indet)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setContentIntent(Notifier.open(this, pid, 1))
                .build();
    }

    @Override public void onDestroy() { running = false; if (worker != null) worker.interrupt(); super.onDestroy(); }
}

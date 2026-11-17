package app.stak.builder;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

final class Notifier {
    static final String CH_BUILDS = "builds";
    static final String CH_LIVE = "live";
    static final int LIVE_ID = 7001;

    private Notifier() {}

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager m = c.getSystemService(NotificationManager.class);
        NotificationChannel b = new NotificationChannel(CH_BUILDS, "Build updates", NotificationManager.IMPORTANCE_HIGH);
        b.setDescription("When a build finishes, fails or needs your answers");
        NotificationChannel l = new NotificationChannel(CH_LIVE, "Live build tracking", NotificationManager.IMPORTANCE_LOW);
        l.setDescription("Ongoing progress while Stak is building");
        l.setShowBadge(false);
        m.createNotificationChannel(b);
        m.createNotificationChannel(l);
    }

    static boolean allowed(Context c) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        return NotificationManagerCompat.from(c).areNotificationsEnabled();
    }

    static PendingIntent open(Context c, String projectId, int req) {
        Intent i = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (projectId != null && !projectId.isEmpty()) i.putExtra("projectId", projectId);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static String eventLine(JSONObject e) {
        String t = e.optString("type"), title = e.optString("title", "Project");
        switch (t) {
            case "build_done": return title + " is ready";
            case "edit_done": return title + " updated";
            case "questions_ready": return title + " needs answers";
            case "job_failed": return title + " stopped";
            default: return title;
        }
    }

    static void event(Context c, JSONObject e) {
        if (e == null) return;
        String t = e.optString("type");
        String body;
        switch (t) {
            case "build_done": body = e.optString("body", "Your build finished") + " · tap to open"; break;
            case "edit_done": body = e.optString("body", "Your edit is live"); break;
            case "questions_ready": body = "Answer a few quick questions to start the build"; break;
            case "job_failed": body = e.optString("body", "Tap to retry"); break;
            default: body = e.optString("body", "");
        }
        post(c, eventLine(e), body, e.optString("projectId"), (int) (e.optLong("id") % 100000));
    }

    static void post(Context c, String title, String body, String projectId, int id) {
        channels(c);
        if (!allowed(c)) return;
        NotificationCompat.Builder n = new NotificationCompat.Builder(c, CH_BUILDS)
                .setSmallIcon(R.drawable.ic_stat_stak)
                .setColor(0xFFF26B1D)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setContentIntent(open(c, projectId, id));
        try { NotificationManagerCompat.from(c).notify(id + 10, n.build()); } catch (SecurityException ignored) {}
    }
}

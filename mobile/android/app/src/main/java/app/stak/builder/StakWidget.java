package app.stak.builder;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.text.format.DateUtils;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** 2x2 (resizable) home-screen widget: live build progress, current project, counts, last event. */
public class StakWidget extends AppWidgetProvider {
    static final String REFRESH = "app.stak.builder.WIDGET_REFRESH";

    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, views(c));
        if (Store.signedIn(c)) SyncWorker.now(c);
    }

    @Override public void onEnabled(Context c) { SyncWorker.schedule(c); }

    @Override public void onReceive(Context c, Intent i) {
        super.onReceive(c, i);
        if (REFRESH.equals(i.getAction())) {
            JSONObject s = Store.summary(c);
            if (Sync.building(s)) LiveService.start(c);
            SyncWorker.now(c);
            updateAll(c);
        }
    }

    static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, StakWidget.class));
        if (ids.length == 0) return;
        RemoteViews v = views(c);
        for (int id : ids) m.updateAppWidget(id, v);
    }

    static RemoteViews views(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_stak);
        JSONObject s = Store.summary(c);
        String openPid = null;

        if (!Store.signedIn(c) || s == null) {
            chip(v, "SETUP", false);
            v.setTextViewText(R.id.w_title, Store.signedIn(c) ? "Syncing…" : "Open Stak to start");
            v.setTextViewText(R.id.w_sub, "Your builds show up here live");
            v.setViewVisibility(R.id.w_progress, View.GONE);
            v.setViewVisibility(R.id.w_time, View.GONE);
            v.setTextViewText(R.id.w_foot, "Tap to open");
        } else {
            JSONArray active = s.optJSONArray("active");
            JSONArray pending = s.optJSONArray("pending");
            JSONArray recent = s.optJSONArray("recent");
            JSONObject st = s.optJSONObject("stats");
            int building = st == null ? 0 : st.optInt("building"), ready = st == null ? 0 : st.optInt("ready"), asks = st == null ? 0 : st.optInt("needsAnswers");

            if (active != null && active.length() > 0) {
                JSONObject j = active.optJSONObject(0);
                int pct = (int) Math.round(j.optDouble("progress", 0) * 100);
                openPid = j.optString("projectId");
                chip(v, "LIVE", true);
                v.setTextViewText(R.id.w_title, j.optString("title", "Project"));
                v.setTextViewText(R.id.w_sub, Phases.label(j.optString("phase")) + " · " + pct + "%");
                v.setViewVisibility(R.id.w_progress, View.VISIBLE);
                v.setProgressBar(R.id.w_progress, 100, Math.max(3, pct), false);
                v.setViewVisibility(R.id.w_time, View.VISIBLE);
                v.setTextViewText(R.id.w_time, Phases.clock(j.optLong("elapsed")));
            } else if (pending != null && pending.length() > 0) {
                JSONObject p = pending.optJSONObject(0);
                openPid = p.optString("projectId");
                chip(v, "ASK", true);
                v.setTextViewText(R.id.w_title, p.optString("title", "Project"));
                v.setTextViewText(R.id.w_sub, p.optInt("count") + " questions waiting");
                v.setViewVisibility(R.id.w_progress, View.GONE);
                v.setViewVisibility(R.id.w_time, View.GONE);
            } else if (recent != null && recent.length() > 0) {
                JSONObject p = recent.optJSONObject(0);
                openPid = p.optString("id");
                chip(v, "READY", false);
                v.setTextViewText(R.id.w_title, p.optString("title", "Project"));
                long upd = p.optLong("updated");
                String ago = upd > 0 ? DateUtils.getRelativeTimeSpanString(upd, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE).toString() : "";
                v.setTextViewText(R.id.w_sub, "v" + Math.max(1, p.optInt("version")) + " · " + p.optString("stage", "ready") + (ago.isEmpty() ? "" : " · " + ago));
                v.setViewVisibility(R.id.w_progress, View.GONE);
                v.setViewVisibility(R.id.w_time, View.GONE);
            } else {
                chip(v, "NEW", false);
                v.setTextViewText(R.id.w_title, "No projects yet");
                v.setTextViewText(R.id.w_sub, "Describe an app to build it");
                v.setViewVisibility(R.id.w_progress, View.GONE);
                v.setViewVisibility(R.id.w_time, View.GONE);
            }
            String last = Store.prefs(c).getString("lastEventText", "");
            String counts = building + " building · " + ready + " ready" + (asks > 0 ? " · " + asks + " ask" : "");
            v.setTextViewText(R.id.w_foot, building == 0 && !last.isEmpty() ? last : counts);
        }

        v.setOnClickPendingIntent(R.id.w_root, Notifier.open(c, openPid, 2));
        Intent r = new Intent(c, StakWidget.class).setAction(REFRESH);
        v.setOnClickPendingIntent(R.id.w_refresh, PendingIntent.getBroadcast(c, 3, r, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return v;
    }

    private static void chip(RemoteViews v, String text, boolean hot) {
        v.setTextViewText(R.id.w_chip, text);
        v.setInt(R.id.w_chip, "setBackgroundResource", hot ? R.drawable.widget_chip_hot : R.drawable.widget_chip);
        v.setTextColor(R.id.w_chip, hot ? 0xFFF26B1D : 0xFFA8A29A);
        v.setViewVisibility(R.id.w_dot, hot ? View.VISIBLE : View.GONE);
    }
}

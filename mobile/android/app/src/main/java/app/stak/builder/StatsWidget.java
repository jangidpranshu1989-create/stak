package app.stak.builder;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 2x1 stats: builds running, live apps and today's AI usage. */
public class StatsWidget extends AppWidgetProvider {
    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, views(c));
        if (Store.signedIn(c)) SyncWorker.now(c);
    }
    @Override public void onEnabled(Context c) { SyncWorker.schedule(c); }

    static void updateAll(Context c) {
        int[] ids = Widgets.ids(c, StatsWidget.class);
        if (ids.length == 0) return;
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        RemoteViews v = views(c);
        for (int id : ids) m.updateAppWidget(id, v);
    }

    static RemoteViews views(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_stats);
        JSONObject s = Store.summary(c);
        JSONObject st = s == null ? null : s.optJSONObject("stats");
        JSONObject u = s == null ? null : s.optJSONObject("usage");
        int building = st == null ? 0 : st.optInt("building"), ready = st == null ? 0 : st.optInt("ready");
        int used = u == null ? 0 : u.optInt("aiUsed"), limit = u == null ? 0 : u.optInt("aiLimit");
        v.setTextViewText(R.id.s_building, String.valueOf(building));
        v.setTextViewText(R.id.s_ready, String.valueOf(ready));
        v.setProgressBar(R.id.s_progress, 100, limit > 0 ? Math.min(100, Math.round(used * 100f / limit)) : 0, false);
        v.setTextViewText(R.id.s_foot, !Store.signedIn(c) ? "Open Stak to sign in" : limit > 0 ? "AI today " + used + " / " + limit : "Syncing…");
        v.setOnClickPendingIntent(R.id.s_root, Widgets.route(c, "activity", null, 30));
        return v;
    }
}

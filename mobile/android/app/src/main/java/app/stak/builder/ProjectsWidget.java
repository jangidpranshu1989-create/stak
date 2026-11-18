package app.stak.builder;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** 4x2 (resizable) scrollable list of recent projects with live status; each row opens its workspace. */
public class ProjectsWidget extends AppWidgetProvider {
    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, views(c, id));
        m.notifyAppWidgetViewDataChanged(ids, R.id.p_list);
        if (Store.signedIn(c)) SyncWorker.now(c);
    }
    @Override public void onEnabled(Context c) { SyncWorker.schedule(c); }

    static void updateAll(Context c) {
        int[] ids = Widgets.ids(c, ProjectsWidget.class);
        if (ids.length == 0) return;
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        for (int id : ids) m.updateAppWidget(id, views(c, id));
        m.notifyAppWidgetViewDataChanged(ids, R.id.p_list);
    }

    static RemoteViews views(Context c, int id) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_projects);
        Intent svc = new Intent(c, ProjectsWidgetService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.p_list, svc);
        v.setEmptyView(R.id.p_list, R.id.p_empty);

        JSONObject s = Store.summary(c);
        JSONObject st = s == null ? null : s.optJSONObject("stats");
        JSONArray recent = s == null ? null : s.optJSONArray("recent");
        int building = st == null ? 0 : st.optInt("building");
        v.setTextViewText(R.id.p_count, st == null ? "" : building > 0 ? building + " building" : st.optInt("projects") + " total");
        v.setTextViewText(R.id.p_empty, !Store.signedIn(c) ? "Open Stak to sign in" : (recent == null ? "Syncing…" : "No projects yet — tap + to build one"));

        // Row taps fill in the projectId; the template must be mutable for fill-in extras.
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (android.os.Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        v.setPendingIntentTemplate(R.id.p_list, PendingIntent.getActivity(c, 40, open, flags));
        v.setOnClickPendingIntent(R.id.p_new, Widgets.route(c, "create", null, 41));
        v.setOnClickPendingIntent(R.id.p_head, Widgets.route(c, "projects", null, 42));
        return v;
    }
}

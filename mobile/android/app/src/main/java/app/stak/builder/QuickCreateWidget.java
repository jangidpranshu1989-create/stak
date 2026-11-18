package app.stak.builder;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

/** 4x1 quick-create bar: "Describe an app…" plus one-tap chatbot / tracker / game ideas. */
public class QuickCreateWidget extends AppWidgetProvider {
    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) { for (int id : ids) m.updateAppWidget(id, views(c)); }

    static void updateAll(Context c) {
        int[] ids = Widgets.ids(c, QuickCreateWidget.class);
        if (ids.length == 0) return;
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        RemoteViews v = views(c);
        for (int id : ids) m.updateAppWidget(id, v);
    }

    static RemoteViews views(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_quick);
        v.setOnClickPendingIntent(R.id.q_root, Widgets.route(c, "create", null, 20));
        v.setOnClickPendingIntent(R.id.q_input, Widgets.route(c, "create", null, 21));
        v.setOnClickPendingIntent(R.id.q_bot, Widgets.route(c, "create", Widgets.P_CHAT, 22));
        v.setOnClickPendingIntent(R.id.q_chart, Widgets.route(c, "create", Widgets.P_TRACK, 23));
        v.setOnClickPendingIntent(R.id.q_game, Widgets.route(c, "create", Widgets.P_GAME, 24));
        return v;
    }
}

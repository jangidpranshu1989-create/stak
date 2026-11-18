package app.stak.builder;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

/** Shared helpers for every Stak home-screen widget. */
final class Widgets {
    private Widgets() {}

    static final String P_CHAT = "An AI chatbot with saved chat history, suggested starter questions and markdown answers";
    static final String P_TRACK = "Expense tracker in rupees with monthly budget, categories, a donut chart and recent transactions";
    static final String P_GAME = "Snake game with levels, high score, sound effects and mobile swipe controls";

    /** Refresh all widget kinds after new data arrives. */
    static void updateAll(Context c) {
        StakWidget.updateSelf(c);
        QuickCreateWidget.updateAll(c);
        StatsWidget.updateAll(c);
        ProjectsWidget.updateAll(c);
    }

    static int[] ids(Context c, Class<?> k) {
        return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, k));
    }

    /** Open the app on a route ("create", "activity", "projects") with an optional idea to prefill. */
    static PendingIntent route(Context c, String route, String idea, int req) {
        Intent i = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.setAction("app.stak.builder.ROUTE." + req);
        i.putExtra("route", route);
        if (idea != null) i.putExtra("idea", idea);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}

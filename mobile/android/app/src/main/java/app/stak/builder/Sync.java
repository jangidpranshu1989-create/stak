package app.stak.builder;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

/** One sync round: refresh summary, post notifications for new events, redraw widgets. */
final class Sync {
    private Sync() {}

    /** @return the fresh summary, or null when offline / signed out. */
    static synchronized JSONObject run(Context c) {
        JSONObject s = Store.get(c, "/api/mobile/summary");
        if (s != null) Store.saveSummary(c, s.toString());
        long last = Store.prefs(c).getLong("lastEvent", -1);
        JSONObject ev = Store.get(c, "/api/mobile/events" + (last > 0 ? "?after=" + last : ""));
        if (ev != null) {
            JSONArray list = ev.optJSONArray("events");
            long newest = ev.optLong("last", last);
            if (list != null && list.length() > 0) {
                JSONObject tail = list.optJSONObject(list.length() - 1);
                if (tail != null) Store.prefs(c).edit().putString("lastEventText", Notifier.eventLine(tail)).apply();
                if (last >= 0) for (int i = 0; i < list.length(); i++) Notifier.event(c, list.optJSONObject(i));
            }
            if (newest > 0 || last < 0) Store.prefs(c).edit().putLong("lastEvent", Math.max(newest, 0)).apply();
        }
        StakWidget.updateAll(c);
        return s;
    }

    static boolean building(JSONObject s) {
        JSONArray a = s == null ? null : s.optJSONArray("active");
        return a != null && a.length() > 0;
    }
}

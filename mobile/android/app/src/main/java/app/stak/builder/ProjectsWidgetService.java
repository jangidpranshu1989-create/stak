package app.stak.builder;

import android.content.Context;
import android.content.Intent;
import android.text.format.DateUtils;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class ProjectsWidgetService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent) { return new Factory(getApplicationContext()); }

    static class Row { String id, title, sub, badge; boolean hot; }

    static class Factory implements RemoteViewsFactory {
        private final Context c;
        private final List<Row> rows = new ArrayList<>();
        Factory(Context c) { this.c = c; }

        @Override public void onCreate() {}
        @Override public void onDestroy() { rows.clear(); }
        @Override public int getCount() { return rows.size(); }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int p) { return p < rows.size() ? rows.get(p).id.hashCode() : p; }
        @Override public boolean hasStableIds() { return true; }

        @Override public void onDataSetChanged() {
            rows.clear();
            JSONObject s = Store.summary(c);
            if (s == null) return;
            Map<String, JSONObject> live = new HashMap<>();
            JSONArray active = s.optJSONArray("active");
            if (active != null) for (int i = 0; i < active.length(); i++) { JSONObject a = active.optJSONObject(i); if (a != null) live.put(a.optString("projectId"), a); }
            Map<String, Integer> asks = new HashMap<>();
            JSONArray pending = s.optJSONArray("pending");
            if (pending != null) for (int i = 0; i < pending.length(); i++) { JSONObject a = pending.optJSONObject(i); if (a != null) asks.put(a.optString("projectId"), a.optInt("count")); }
            JSONArray recent = s.optJSONArray("recent");
            if (recent == null) return;
            long nowMs = System.currentTimeMillis();
            for (int i = 0; i < recent.length() && i < 8; i++) {
                JSONObject p = recent.optJSONObject(i);
                if (p == null) continue;
                Row r = new Row();
                r.id = p.optString("id");
                r.title = p.optString("title", "Project");
                JSONObject a = live.get(r.id);
                if (a != null) {
                    int pct = (int) Math.round(a.optDouble("progress", 0) * 100);
                    r.sub = Phases.label(a.optString("phase")) + " · " + Phases.clock(a.optLong("elapsed"));
                    r.badge = pct + "%"; r.hot = true;
                } else if (asks.containsKey(r.id)) {
                    r.sub = asks.get(r.id) + " questions waiting"; r.badge = "ASK"; r.hot = true;
                } else {
                    long upd = p.optLong("updated");
                    String ago = upd > 0 ? DateUtils.getRelativeTimeSpanString(upd, nowMs, DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE).toString() : "";
                    int ver = p.optInt("version");
                    r.sub = (ver > 0 ? "v" + ver : "Draft") + (ago.isEmpty() ? "" : " · " + ago);
                    r.badge = ver > 0 ? "LIVE" : ""; r.hot = false;
                }
                rows.add(r);
            }
        }

        @Override public RemoteViews getViewAt(int pos) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_project_row);
            if (pos >= rows.size()) return v;
            Row r = rows.get(pos);
            String t = r.title.trim();
            v.setTextViewText(R.id.r_tile, t.isEmpty() ? "S" : t.substring(0, 1).toUpperCase());
            v.setTextViewText(R.id.r_title, r.title);
            v.setTextViewText(R.id.r_sub, r.sub);
            if (r.badge == null || r.badge.isEmpty()) v.setViewVisibility(R.id.r_badge, View.GONE);
            else {
                v.setViewVisibility(R.id.r_badge, View.VISIBLE);
                v.setTextViewText(R.id.r_badge, r.badge);
                v.setInt(R.id.r_badge, "setBackgroundResource", r.hot ? R.drawable.widget_chip_hot : R.drawable.widget_chip);
                v.setTextColor(R.id.r_badge, r.hot ? 0xFFFF8A3D : 0xFF7EE2A8);
            }
            v.setOnClickFillInIntent(R.id.r_root, new Intent().putExtra("projectId", r.id));
            return v;
        }
    }
}

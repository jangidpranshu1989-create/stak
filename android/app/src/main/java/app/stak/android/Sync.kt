package app.stak.android

import android.content.Context
import org.json.JSONObject

/** One sync pass: fetch summary + new events, notify, refresh widgets. Returns true if something is still building. */
object Sync {
    @Synchronized
    fun run(ctx: Context): Boolean {
        val p = Api.prefs(ctx)
        val summary = Api.get("/api/mobile/summary")
        if (summary != null) {
            p.edit().putString("summary", summary.toString()).putLong("syncedAt", System.currentTimeMillis()).apply()
        }
        val after = p.getLong("lastEvent", -1L)
        if (after < 0) {
            // first run: remember where we are, don't replay old events
            Api.get("/api/mobile/events")?.let { p.edit().putLong("lastEvent", it.optLong("last", 0)).apply() }
        } else {
            Api.get("/api/mobile/events?after=$after")?.let { ev ->
                val arr = ev.optJSONArray("events")
                if (arr != null) for (i in 0 until arr.length()) Notifier.event(ctx, arr.getJSONObject(i))
                p.edit().putLong("lastEvent", ev.optLong("last", after)).apply()
            }
        }
        Widgets.refreshAll(ctx)
        return (summary?.optJSONObject("stats")?.optInt("building", 0) ?: 0) > 0
    }

    fun summary(ctx: Context): JSONObject? = Api.prefs(ctx).getString("summary", null)?.let { try { JSONObject(it) } catch (e: Exception) { null } }
}

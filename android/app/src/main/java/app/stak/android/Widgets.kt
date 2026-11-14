package app.stak.android

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews

object Widgets {
    fun refreshAll(ctx: Context) {
        val m = AppWidgetManager.getInstance(ctx)
        for ((cls, fn) in listOf<Pair<Class<*>, (Context) -> RemoteViews>>(
            LiveBuildWidget::class.java to ::live, ProjectsWidget::class.java to ::projects, QuickBuildWidget::class.java to ::quick)) {
            val ids = m.getAppWidgetIds(ComponentName(ctx, cls))
            if (ids.isNotEmpty()) m.updateAppWidget(ids, fn(ctx))
        }
    }

    private fun ago(ms: Long): String {
        if (ms <= 0) return ""
        val s = (System.currentTimeMillis() - ms) / 1000
        return when { s < 60 -> "just now"; s < 3600 -> "${s / 60} min ago"; s < 86400 -> "${s / 3600} h ago"; else -> "${s / 86400} d ago" }
    }

    fun live(ctx: Context): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_live)
        val s = Sync.summary(ctx)
        val a = s?.optJSONArray("active")?.optJSONObject(0)
        if (s == null) {
            v.setTextViewText(R.id.title, "Open Stak to sign in"); v.setTextViewText(R.id.phase, "Your builds will show up here")
            v.setProgressBar(R.id.progress, 100, 0, false); v.setTextViewText(R.id.badge, ""); v.setTextViewText(R.id.foot, "")
            v.setOnClickPendingIntent(R.id.root, Notifier.openIntent(ctx, null, 11))
        } else if (a != null) {
            val phase = a.optString("phase").replace('_', ' ').replaceFirstChar { it.uppercase() }
            v.setTextViewText(R.id.title, a.optString("title"))
            v.setTextViewText(R.id.phase, phase.ifEmpty { "Building" } + " · " + a.optInt("elapsed") + "s")
            v.setProgressBar(R.id.progress, 100, (a.optDouble("progress", 0.1) * 100).toInt().coerceIn(3, 99), false)
            v.setTextViewText(R.id.badge, "LIVE")
            val more = (s.optJSONArray("active")?.length() ?: 1) - 1
            v.setTextViewText(R.id.foot, if (more > 0) "+$more more building" else "Updated " + ago(Api.prefs(ctx).getLong("syncedAt", 0)))
            v.setOnClickPendingIntent(R.id.root, Notifier.openIntent(ctx, a.optString("projectId"), 12))
        } else {
            val r = s.optJSONArray("recent")?.optJSONObject(0)
            v.setTextViewText(R.id.badge, "")
            v.setTextViewText(R.id.title, r?.optString("title") ?: "Nothing building")
            v.setTextViewText(R.id.phase, if (r != null) (if (r.optInt("version") > 0) "Ready · v" + r.optInt("version") else "Waiting for you") else "Tap to start something new")
            v.setProgressBar(R.id.progress, 100, if (r != null && r.optInt("version") > 0) 100 else 0, false)
            v.setTextViewText(R.id.foot, "Updated " + ago(Api.prefs(ctx).getLong("syncedAt", 0)))
            v.setOnClickPendingIntent(R.id.root, Notifier.openIntent(ctx, r?.optString("id"), 13))
        }
        return v
    }

    fun projects(ctx: Context): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_projects)
        val s = Sync.summary(ctx)
        val st = s?.optJSONObject("stats")
        val pending = s?.optJSONArray("pending")
        val waiting = st?.optInt("needsAnswers", 0) ?: 0
        if (waiting > 0) {
            v.setTextViewText(R.id.big, waiting.toString()); v.setTextViewText(R.id.bigLabel, if (waiting == 1) "project needs your answers" else "projects need your answers")
            v.setTextColor(R.id.bigLabel, 0xFFFF7A18.toInt())
        } else {
            v.setTextViewText(R.id.big, (st?.optInt("ready", 0) ?: 0).toString()); v.setTextViewText(R.id.bigLabel, "projects ready")
            v.setTextColor(R.id.bigLabel, 0xFFA1A1AA.toInt())
        }
        val recent = s?.optJSONArray("recent")
        val first = pending?.optJSONObject(0)
        v.setTextViewText(R.id.line1, first?.let { "Answer: " + it.optString("title") } ?: recent?.optJSONObject(0)?.optString("title") ?: "No projects yet")
        v.setTextViewText(R.id.line2, recent?.optJSONObject(if (first != null) 0 else 1)?.optString("title") ?: "")
        v.setTextViewText(R.id.stats, if (st != null) "${st.optInt("projects")} projects · ${st.optInt("building")} building" else "Open Stak to sign in")
        v.setOnClickPendingIntent(R.id.root, Notifier.openIntent(ctx, first?.optString("projectId") ?: "", 21))
        return v
    }

    fun quick(ctx: Context): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_quick)
        v.setOnClickPendingIntent(R.id.btnNew, Notifier.openIntent(ctx, "new", 31))
        v.setOnClickPendingIntent(R.id.btnVoice, Notifier.openIntent(ctx, null, 32))
        v.setOnClickPendingIntent(R.id.root, Notifier.openIntent(ctx, "new", 33))
        return v
    }
}

abstract class BaseWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, m: AppWidgetManager, ids: IntArray) {
        Widgets.refreshAll(ctx)
        SyncJob.schedule(ctx)
        val r = goAsync()
        Thread { try { Sync.run(ctx) } finally { r.finish() } }.start()
    }
}
class LiveBuildWidget : BaseWidget()
class ProjectsWidget : BaseWidget()
class QuickBuildWidget : BaseWidget()

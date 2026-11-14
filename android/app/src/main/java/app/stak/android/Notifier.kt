package app.stak.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.app.Notification
import org.json.JSONObject

object Notifier {
    const val CH_ALERTS = "alerts"
    const val CH_SYNC = "sync"

    fun channels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_ALERTS, "Builds and questions", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "When Stak needs your answers, or a build finishes"
        })
        nm.createNotificationChannel(NotificationChannel(CH_SYNC, "Live build", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shown while a build runs in the background"; setShowBadge(false)
        })
    }

    fun openIntent(ctx: Context, projectId: String?, req: Int): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse(if (projectId.isNullOrEmpty()) "stak://app/" else "stak://app/$projectId")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun event(ctx: Context, e: JSONObject) {
        if (MainActivity.visible) return // the app is open: the page already shows it
        val type = e.optString("type")
        val pid = e.optString("projectId")
        val title = e.optString("title").ifEmpty { "Stak" }
        val (head, body) = when (type) {
            "questions_ready" -> "Your answers are needed" to "$title — ${e.optString("body").ifEmpty { "3 quick questions, then Stak starts building." }}"
            "build_done" -> "Your build is ready" to "$title — tap to open it."
            "edit_done" -> "Changes applied" to "$title — your update is live."
            "job_failed" -> "Build stopped" to "$title — ${e.optString("body").ifEmpty { "tap Retry to run it again." }}"
            else -> return
        }
        val n = Notification.Builder(ctx, CH_ALERTS)
            .setSmallIcon(R.drawable.ic_notif)
            .setColor(0xFFFF5A1F.toInt())
            .setContentTitle(head)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(openIntent(ctx, pid, (pid + type).hashCode()))
            .apply { if (type == "questions_ready") setCategory(Notification.CATEGORY_REMINDER) }
            .build()
        try { ctx.getSystemService(NotificationManager::class.java).notify((pid + type).hashCode(), n) } catch (_: SecurityException) {}
    }
}

package app.stak.android

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder

/** Foreground service that follows running builds every few seconds, then stops itself. */
class SyncService : Service() {
    private lateinit var thread: HandlerThread
    private lateinit var h: Handler
    private var idleRounds = 0

    override fun onCreate() {
        super.onCreate()
        Notifier.channels(this)
        thread = HandlerThread("stak-sync").also { it.start() }
        h = Handler(thread.looper)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val n = Notification.Builder(this, Notifier.CH_SYNC)
            .setSmallIcon(R.drawable.ic_notif).setContentTitle("Stak is building")
            .setContentText("You can close the app — you'll get a notification.")
            .setOngoing(true).setContentIntent(Notifier.openIntent(this, null, 1)).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(42, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(42, n)
        idleRounds = 0
        h.removeCallbacksAndMessages(null)
        h.post(tick)
        return START_NOT_STICKY
    }

    private val tick = object : Runnable {
        override fun run() {
            val building = Sync.run(this@SyncService)
            idleRounds = if (building) 0 else idleRounds + 1
            // keep following for ~40 s after the last build, so follow-up questions are caught too
            if (idleRounds > 10) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return }
            h.postDelayed(this, if (building) 3000 else 4000)
        }
    }

    override fun onDestroy() { h.removeCallbacksAndMessages(null); thread.quitSafely(); super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        fun start(ctx: Context) { try { ctx.startForegroundService(Intent(ctx, SyncService::class.java)) } catch (_: Exception) { SyncJob.kick(ctx) } }
    }
}

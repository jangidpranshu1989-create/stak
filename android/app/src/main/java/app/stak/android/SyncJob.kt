package app.stak.android

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context

/** Periodic background sync (every 15 min, the Android minimum) for notifications and widgets. */
class SyncJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        Thread {
            val building = Sync.run(this)
            if (building) SyncService.start(this)
            jobFinished(params, false)
        }.start()
        return true
    }
    override fun onStopJob(params: JobParameters) = true

    companion object {
        fun schedule(ctx: Context) {
            val js = ctx.getSystemService(JobScheduler::class.java)
            js.schedule(JobInfo.Builder(7, ComponentName(ctx, SyncJob::class.java))
                .setPeriodic(15 * 60 * 1000L).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).build())
        }
        fun kick(ctx: Context) {
            val js = ctx.getSystemService(JobScheduler::class.java)
            js.schedule(JobInfo.Builder(8, ComponentName(ctx, SyncJob::class.java)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setOverrideDeadline(1000).build())
        }
    }
}

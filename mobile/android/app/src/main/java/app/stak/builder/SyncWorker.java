package app.stak.builder;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

/** Background sync while the app is closed (Android minimum: every 15 minutes). */
public class SyncWorker extends Worker {
    public SyncWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    @NonNull @Override public Result doWork() {
        if (!Store.signedIn(getApplicationContext())) return Result.success();
        Sync.run(getApplicationContext());
        return Result.success();
    }

    private static Constraints net() { return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(); }

    static void schedule(Context c) {
        PeriodicWorkRequest r = new PeriodicWorkRequest.Builder(SyncWorker.class, 15, TimeUnit.MINUTES).setConstraints(net()).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork("stak-sync", ExistingPeriodicWorkPolicy.KEEP, r);
    }

    static void now(Context c) {
        OneTimeWorkRequest r = new OneTimeWorkRequest.Builder(SyncWorker.class).setConstraints(net()).build();
        WorkManager.getInstance(c).enqueueUniqueWork("stak-sync-now", ExistingWorkPolicy.REPLACE, r);
    }

    static void cancel(Context c) { WorkManager.getInstance(c).cancelUniqueWork("stak-sync"); }
}

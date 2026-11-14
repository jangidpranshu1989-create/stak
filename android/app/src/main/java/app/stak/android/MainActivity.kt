package app.stak.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.webkit.*
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var web: WebView
    private var fileCb: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Notifier.channels(this)
        SyncJob.schedule(this)
        window.statusBarColor = Color.parseColor("#0B0B0D")
        window.navigationBarColor = Color.parseColor("#0B0B0D")

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#0B0B0D"))
        setContentView(web)
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportZoom(false)
            userAgentString = "$userAgentString StakAndroid/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(Bridge(), "StakAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                val base = Uri.parse(Api.base)
                if (u.host == base.host) return false
                if (u.scheme == "stak") { open(u); return true }
                // the live preview iframe stays inside; top-level external links open in the browser
                return try { startActivity(Intent(Intent.ACTION_VIEW, u)); true } catch (e: ActivityNotFoundException) { false }
            }
            override fun onPageFinished(view: WebView?, url: String?) { CookieManager.getInstance().flush() }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null); fileCb = cb
                return try { startActivityForResult(p.createIntent(), 77); true } catch (e: Exception) { fileCb = null; false }
            }
            override fun onPermissionRequest(r: PermissionRequest) {
                if (r.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) r.grant(r.resources)
                    else { pendingPerm = r; requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 78) }
                } else r.deny()
            }
        }
        web.setDownloadListener { url, ua, cd, mime, _ ->
            try {
                val name = URLUtil.guessFileName(url, cd, mime)
                val rq = DownloadManager.Request(Uri.parse(url))
                    .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                    .addRequestHeader("User-Agent", ua)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                getSystemService(DownloadManager::class.java).enqueue(rq)
                Toast.makeText(this, "Downloading $name", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        }
        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else open(intent?.data)

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 79)
    }

    private var pendingPerm: PermissionRequest? = null

    private fun open(u: Uri?) {
        val target = if (u != null && u.scheme == "stak") {
            val id = u.pathSegments.firstOrNull().orEmpty()
            when { id.isEmpty() -> "/#/app"; else -> "/#/app/$id" }
        } else "/#/app"
        web.loadUrl(Api.base + target)
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); open(intent.data) }
    override fun onResume() { super.onResume(); visible = true; web.onResume() }
    override fun onPause() { visible = false; web.onPause(); CookieManager.getInstance().flush(); super.onPause(); Thread { Sync.run(applicationContext) }.start() }
    override fun onSaveInstanceState(out: Bundle) { super.onSaveInstanceState(out); web.saveState(out) }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(req: Int, res: Int, data: Intent?) {
        if (req == 77) { fileCb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data)); fileCb = null; return }
        super.onActivityResult(req, res, data)
    }

    override fun onRequestPermissionsResult(req: Int, perms: Array<out String>, res: IntArray) {
        if (req == 78) { val r = pendingPerm; pendingPerm = null; if (res.firstOrNull() == PackageManager.PERMISSION_GRANTED) r?.grant(r.resources) else r?.deny() }
    }

    inner class Bridge {
        /** Called by the page when a build / questions job starts — follow it natively in the background. */
        @JavascriptInterface fun jobStarted() { runOnUiThread { SyncService.start(applicationContext) } }
        @JavascriptInterface fun refreshWidgets() { Thread { Sync.run(applicationContext) }.start() }
        @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME
    }

    companion object { @Volatile var visible = false }
}

package app.stak.android

import android.content.Context
import android.webkit.CookieManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object Api {
    val base: String get() = BuildConfig.BASE_URL.trimEnd('/')

    /** GET a JSON endpoint with the WebView's session cookie. Returns null when signed out or offline. */
    fun get(path: String): JSONObject? {
        return try {
            val cookie = CookieManager.getInstance().getCookie(base) ?: return null
            val c = (URL(base + path).openConnection() as HttpURLConnection).apply {
                connectTimeout = 10000; readTimeout = 15000
                setRequestProperty("Cookie", cookie)
                setRequestProperty("Accept", "application/json")
                setRequestProperty("User-Agent", "StakAndroid/" + BuildConfig.VERSION_NAME)
            }
            if (c.responseCode != 200) { c.disconnect(); return null }
            val s = c.inputStream.bufferedReader().use { it.readText() }
            c.disconnect()
            JSONObject(s)
        } catch (e: Exception) { null }
    }

    fun prefs(ctx: Context) = ctx.getSharedPreferences("stak", Context.MODE_PRIVATE)
}

package app.stak.builder;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Session + cached state shared by the WebView bridge, widget, live service and background worker. */
final class Store {
    static final String WEB = "https://stak-ai.pplx.app";
    private static final String P = "stak";

    private Store() {}

    static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences(P, Context.MODE_PRIVATE); }
    static String token(Context c) { return prefs(c).getString("token", ""); }
    static String api(Context c) { return prefs(c).getString("api", WEB + "/port/5000"); }
    static boolean signedIn(Context c) { return !token(c).isEmpty(); }

    static void setSession(Context c, String token, String api) {
        SharedPreferences.Editor e = prefs(c).edit().putString("token", token == null ? "" : token);
        if (api != null && api.startsWith("https://")) e.putString("api", api);
        if (token == null || token.isEmpty()) e.remove("summary").remove("lastEvent").remove("lastEventText");
        e.apply();
    }

    static void saveSummary(Context c, String json) { prefs(c).edit().putString("summary", json).putLong("summaryAt", System.currentTimeMillis()).apply(); }
    static JSONObject summary(Context c) {
        try { String s = prefs(c).getString("summary", null); return s == null ? null : new JSONObject(s); } catch (Exception e) { return null; }
    }
    static long summaryAt(Context c) { return prefs(c).getLong("summaryAt", 0); }

    /** GET an API path with the stored bearer token. Returns null on any failure. */
    static JSONObject get(Context c, String path) {
        String t = token(c);
        if (t.isEmpty()) return null;
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) new URL(api(c) + path).openConnection();
            h.setConnectTimeout(8000);
            h.setReadTimeout(10000);
            h.setRequestProperty("Authorization", "Bearer " + t);
            h.setRequestProperty("Accept", "application/json");
            int code = h.getResponseCode();
            if (code == 401) { setSession(c, "", null); return null; }
            if (code < 200 || code >= 300) return null;
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(h.getInputStream(), StandardCharsets.UTF_8))) {
                String line; while ((line = r.readLine()) != null) sb.append(line);
            }
            return new JSONObject(sb.toString());
        } catch (Exception e) {
            return null;
        } finally {
            if (h != null) h.disconnect();
        }
    }
}

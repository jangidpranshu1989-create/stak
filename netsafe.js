// SSRF guard: only public http(s) hosts; every redirect hop is re-checked.
const dns = require("dns").promises;
const net = require("net");

function privateIp(a) {
  a = String(a).toLowerCase();
  const m = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) a = m[1];
  if (net.isIPv4(a)) {
    return /^(0\.|10\.|127\.|169\.254\.|192\.168\.|192\.0\.0\.|198\.1[89]\.|22[4-9]\.|2[3-5]\d\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
  }
  return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^::ffff:/.test(a) || /^64:ff9b:/.test(a);
}

async function safeUrl(u) {
  let url;
  try { url = new URL(u); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || /\.(local|internal|localhost)$/.test(h) || h === "metadata.google.internal") return null;
  let addrs = [];
  try { addrs = net.isIP(h) ? [h] : (await dns.lookup(h, { all: true, verbatim: true })).map((a) => a.address); } catch { return null; }
  if (!addrs.length || addrs.some(privateIp)) return null;
  return url;
}

// fetch with manual redirects (max 5), each hop validated
async function safeFetch(u, opts = {}, hops = 5) {
  let url = await safeUrl(u);
  if (!url) throw Object.assign(new Error("That URL isn't allowed"), { code: "BLOCKED" });
  for (let i = 0; i <= hops; i++) {
    const r = await fetch(url, { ...opts, redirect: "manual" });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      const next = await safeUrl(new URL(r.headers.get("location"), url).toString());
      if (!next) throw Object.assign(new Error("Redirect to a blocked address"), { code: "BLOCKED" });
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && opts.method && opts.method !== "GET")) opts = { ...opts, method: "GET", body: undefined };
      url = next; continue;
    }
    return r;
  }
  throw new Error("Too many redirects");
}

module.exports = { safeUrl, safeFetch, privateIp };

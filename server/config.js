// Server configuration from environment variables. Only key NAMES live in the repo (.env.example).
const env = (k) => (process.env[k] || "").trim();

// Optional outbound proxy (HTTPS_PROXY) support for Node's built-in fetch.
// Some hosts / sandboxes inject API credentials through an HTTPS proxy; Node 20 fetch ignores HTTPS_PROXY by default.
if (env("STAK_USE_PROXY") === "1" && (env("HTTPS_PROXY") || env("https_proxy"))) {
  try {
    // Tunnel through the HTTPS proxy ourselves: some proxies need "Host: name:443" on CONNECT, which undici's ProxyAgent omits.
    const { setGlobalDispatcher, Agent, buildConnector } = require("undici");
    const tls = require("tls"), net = require("net");
    const pu = new URL(env("HTTPS_PROXY") || env("https_proxy"));
    const pauth = pu.username || pu.password ? "Basic " + Buffer.from(decodeURIComponent(pu.username) + ":" + decodeURIComponent(pu.password)).toString("base64") : "";
    const pport = Number(pu.port) || (pu.protocol === "https:" ? 443 : 80);
    // only the engine hosts go through the proxy (it injects their keys); everything else connects directly
    const VIA = new Set(["api.groq.com", "integrate.api.nvidia.com", "generativelanguage.googleapis.com"]);
    const direct = buildConnector({});
    const connect = (opts, cb) => {
      if (!VIA.has(opts.hostname)) return direct(opts, cb);
      const port = Number(opts.port) || 443, target = `${opts.hostname}:${port}`;
      const raw = pu.protocol === "https:" ? tls.connect({ host: pu.hostname, port: pport, servername: pu.hostname }) : net.connect(pport, pu.hostname);
      let done = false; const fail = (e) => { if (!done) { done = true; raw.destroy(); cb(e); } };
      raw.once("error", fail);
      raw.once(pu.protocol === "https:" ? "secureConnect" : "connect", () => {
        raw.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${pauth ? `Proxy-Authorization: ${pauth}\r\n` : ""}\r\n`);
        let buf = "";
        const onData = (d) => {
          buf += d.toString("latin1");
          if (!buf.includes("\r\n\r\n")) return;
          raw.removeListener("data", onData);
          if (!/^HTTP\/1\.[01] 200/.test(buf)) return fail(new Error("proxy " + buf.split("\r\n")[0]));
          const sock = tls.connect({ socket: raw, servername: opts.servername || opts.hostname, ALPNProtocols: ["http/1.1"] });
          sock.once("secureConnect", () => { if (!done) { done = true; cb(null, sock); } });
          sock.once("error", fail);
        };
        raw.on("data", onData);
      });
    };
    setGlobalDispatcher(new Agent({ connect }));
    console.log("[config] outbound fetch goes through HTTPS_PROXY");
  } catch (e) { console.warn("[config] proxy setup failed:", e.message); }
}
const viaProxy = env("STAK_USE_PROXY") === "1";

function provider({ keyVar, baseVar, defBase, label, keyHeader }) {
  const apiKey = env(keyVar), base = (env(baseVar) || defBase).replace(/\/+$/, "");
  if (apiKey) return { label, baseUrl: base, apiKey };
  // credentials injected by an outbound proxy: no key in the app, the proxy adds it
  if (viaProxy && env(`${keyVar}_VIA_PROXY`) === "1") return { label, baseUrl: base, apiKey: null, proxied: true, keyHeader };
  return null;
}

const providers = {};
const groq = provider({ keyVar: "GROQ_API_KEY", baseVar: "GROQ_BASE_URL", defBase: "https://api.groq.com/openai/v1", label: "Groq" });
// Free Groq keys allow ~6-8k tokens per minute per model, too small for full builds. Paid/dev tier: set GROQ_TPM=250000
if (groq) { groq.tpm = Number(env("GROQ_TPM") || 8000) || 0; providers.groq = groq; }
const nvidia = provider({ keyVar: "NVIDIA_API_KEY", baseVar: "NVIDIA_BASE_URL", defBase: "https://integrate.api.nvidia.com/v1", label: "NVIDIA NIM" });
if (nvidia) providers.nvidia = nvidia;
const gemini = provider({ keyVar: "GEMINI_API_KEY", baseVar: "GEMINI_BASE_URL", defBase: "https://generativelanguage.googleapis.com/v1beta/openai", label: "Google Gemini", keyHeader: "x-goog-api-key" });
if (gemini) providers.gemini = gemini;

// web search providers (Groq browser_search is used automatically when Groq is configured)
const search = {};
if (env("TAVILY_API_KEY")) search.tavily = { apiKey: env("TAVILY_API_KEY") };
if (env("BRAVE_API_KEY")) search.brave = { apiKey: env("BRAVE_API_KEY") };
if (env("SERPER_API_KEY")) search.serper = { apiKey: env("SERPER_API_KEY") };
search.groq = !!providers.groq;
search.free = env("STAK_FREE_SEARCH") !== "off"; // DuckDuckGo Lite + page reader fallback

const serverless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

module.exports = {
  providers, search, images: {}, serverless,
  port: Number(env("PORT")) || 5000,
  publicUrl: env("STAK_PUBLIC_URL") || "",
  maxJobs: Number(env("STAK_MAX_JOBS")) || 6,
  // hard wall-clock budget for one job (Vercel functions are capped by maxDuration, default 300 s)
  jobBudgetMs: Number(env("STAK_JOB_BUDGET_MS")) || (serverless ? 280e3 : 600e3),
  apkUrl: env("STAK_APK_URL") || "/stak.apk",
};

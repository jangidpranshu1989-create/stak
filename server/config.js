// Server configuration from environment variables. Only key NAMES live in the repo (.env.example).
const env = (k) => (process.env[k] || "").trim();

// Optional: route all outbound fetch() through HTTPS_PROXY (corporate proxies, credential-injecting sandboxes).
// Node's fetch ignores HTTPS_PROXY by default. Enable with STAK_EGRESS_PROXY=1.
if (env("STAK_EGRESS_PROXY") === "1" && (env("HTTPS_PROXY") || env("https_proxy"))) {
  try { const { setGlobalDispatcher, EnvHttpProxyAgent } = require("undici"); setGlobalDispatcher(new EnvHttpProxyAgent()); console.log("[net] outbound requests use HTTPS_PROXY"); }
  catch (e) { console.warn("[net] STAK_EGRESS_PROXY=1 but undici is not installed:", e.message); }
}

// Perplexity Computer sandbox adapter: credentials are injected as a pass-through proxy URL + proxy key.
// (On a normal host you just set GROQ_API_KEY / NVIDIA_API_KEY — this block is ignored.)
function sandbox(host) {
  const k = host.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const url = env(`CUSTOM_CRED_${k}_URL`), key = env(`CUSTOM_CRED_${k}_PROXY_AUTH_KEY`);
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
}

function provider(name, { keyVar, baseVar, defBase, host, label }) {
  const apiKey = env(keyVar), base = env(baseVar) || defBase;
  if (apiKey) return { label, baseUrl: base.replace(/\/+$/, ""), apiKey };
  const sb = host && sandbox(host);
  if (sb) return { label, baseUrl: sb.url + new URL(defBase).pathname.replace(/\/+$/, ""), proxyKey: sb.key };
  return null;
}

const providers = {};
const groq = provider("groq", { keyVar: "GROQ_API_KEY", baseVar: "GROQ_BASE_URL", defBase: "https://api.groq.com/openai/v1", host: "api.groq.com", label: "Groq" });
// Note: Groq free keys have ~8k TPM per model, but a single request may still produce up to 16k output
// tokens (TPM is enforced on the *next* request). llm.js waits on 429 and rotates models instead of excluding Groq.
if (groq) providers.groq = groq;
const nvidia = provider("nvidia", { keyVar: "NVIDIA_API_KEY", baseVar: "NVIDIA_BASE_URL", defBase: "https://integrate.api.nvidia.com/v1", host: "integrate.api.nvidia.com", label: "NVIDIA NIM" });
if (nvidia) providers.nvidia = nvidia;
if (env("OPENAI_COMPAT_BASE_URL") && env("OPENAI_COMPAT_API_KEY")) {
  providers.custom = {
    label: env("OPENAI_COMPAT_LABEL") || "OpenAI-compatible", baseUrl: env("OPENAI_COMPAT_BASE_URL").replace(/\/+$/, ""), apiKey: env("OPENAI_COMPAT_API_KEY"),
    models: env("OPENAI_COMPAT_MODELS").split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [id, name] = s.split("|"); return { id: id.trim(), name: (name || id).trim() }; }),
  };
}

// photos: real free-licensed photos from Wikimedia Commons (keyless). Set STAK_PHOTOS=off to disable.
const images = { commons: env("STAK_PHOTOS") !== "off" };

// web search providers (Groq browser_search is used automatically when Groq is configured)
const search = {};
if (env("TAVILY_API_KEY")) search.tavily = { apiKey: env("TAVILY_API_KEY") };
if (env("BRAVE_API_KEY")) search.brave = { apiKey: env("BRAVE_API_KEY") };
if (env("SERPER_API_KEY")) search.serper = { apiKey: env("SERPER_API_KEY") };
search.groq = !!providers.groq;
search.free = env("STAK_FREE_SEARCH") !== "off"; // DuckDuckGo Lite + page reader fallback

module.exports = {
  providers, images, search,
  port: Number(env("PORT")) || 5000,
  dataDir: env("STAK_DATA_DIR") || null,
  publicUrl: env("STAK_PUBLIC_URL") || "",
  maxJobs: Number(env("STAK_MAX_JOBS")) || 4,
  photosPerBuild: Number(env("STAK_PHOTOS_PER_BUILD")) || 10,
  sessionDays: Number(env("STAK_SESSION_DAYS")) || 30,
  trustProxy: env("STAK_TRUST_PROXY") || "1",
  repairRounds: Math.min(3, Number(env("STAK_REPAIR_ROUNDS")) || 2),
};

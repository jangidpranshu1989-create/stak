// Server configuration from environment variables. Only key NAMES live in the repo (.env.example).
const env = (k) => (process.env[k] || "").trim();

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
// Groq free/on-demand keys allow ~8k tokens per minute per model, too small for full builds; paid/dev tier: set GROQ_TPM=250000
if (groq) { groq.tpm = Number(process.env.GROQ_TPM || 8000) || 0; providers.groq = groq; }
const nvidia = provider("nvidia", { keyVar: "NVIDIA_API_KEY", baseVar: "NVIDIA_BASE_URL", defBase: "https://integrate.api.nvidia.com/v1", host: "integrate.api.nvidia.com", label: "NVIDIA NIM" });
if (nvidia) providers.nvidia = nvidia;
if (env("OPENAI_COMPAT_BASE_URL") && env("OPENAI_COMPAT_API_KEY")) {
  providers.custom = {
    label: env("OPENAI_COMPAT_LABEL") || "OpenAI-compatible", baseUrl: env("OPENAI_COMPAT_BASE_URL").replace(/\/+$/, ""), apiKey: env("OPENAI_COMPAT_API_KEY"),
    models: env("OPENAI_COMPAT_MODELS").split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [id, name] = s.split("|"); return { id: id.trim(), name: (name || id).trim() }; }),
  };
}

// image providers — DISABLED: no image generation to improve speed
const images = {};
// All image providers explicitly disabled — AI will use CSS gradients, SVGs, or Unsplash URLs only

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
  imagesPerBuild: Number(env("STAK_IMAGES_PER_BUILD")) || 16,
};

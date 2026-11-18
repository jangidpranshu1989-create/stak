// LLM layer — 100% OpenAI-compatible (Chat Completions + SSE streaming).
// Built-in providers: Groq, NVIDIA NIM, and any OpenAI-compatible endpoint configured by env (see server/config.js).
// Built-in "Stak" presets (Pro / Think / Fast / Search) are ordered fallback chains across providers;
// every catalog model can also be picked directly. User-added models (own keys) are handled by kind:"user".
const CFG = require("./config");

// ----------------------------------------------------------------- catalog
// id: "<provider>:<model>"  ·  out = max output tokens we request  ·  reasoning = supports reasoning_effort
const CATALOG = [
  // Groq — LPU speed. GPT-OSS supports reasoning_effort + built-in browser_search.
  { provider: "groq", model: "openai/gpt-oss-120b", name: "GPT-OSS 120B", by: "Groq", cats: ["deep", "thinking"], out: 16000, reasoning: true, search: true, desc: "Best all-round builder · reasoning · web search" },
  { provider: "groq", model: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B", by: "Groq", cats: ["deep", "fast"], out: 16384, desc: "Long, detailed pages · very fast" },
  { provider: "groq", model: "openai/gpt-oss-20b", name: "GPT-OSS 20B", by: "Groq", cats: ["fast"], out: 16000, reasoning: true, search: true, desc: "Fastest · great for edits & landing pages" },
  // NVIDIA NIM — huge open-model catalog (availability varies; health-checked at runtime)
  { provider: "nvidia", model: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra 550B", by: "NVIDIA", cats: ["deep", "thinking"], out: 32000, desc: "Very detailed full builds · slower" },
  { provider: "nvidia", model: "mistralai/mistral-large-4-1t-a52b", name: "Mistral Large 4", by: "NVIDIA", cats: ["deep"], out: 16000, desc: "1T-param flagship" },
  { provider: "nvidia", model: "minimaxai/minimax-m3.1-flash", name: "MiniMax M3.1 Flash", by: "NVIDIA", cats: ["fast"], out: 16000, desc: "Fast agentic coder" },
  { provider: "nvidia", model: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash", by: "NVIDIA", cats: ["fast"], out: 16000, desc: "Fast coder" },
  { provider: "nvidia", model: "stepfun-ai/step-5-preview", name: "Step 5 Preview", by: "NVIDIA", cats: ["deep"], out: 16000, desc: "New frontier preview" },
  { provider: "nvidia", model: "poolside/laguna-xs-2.1", name: "Laguna XS 2.1", by: "NVIDIA", cats: ["fast"], out: 16000, desc: "Compact coding model" },
  { provider: "nvidia", model: "nvidia/nemotron-3.5-lightning-30b-a3b", name: "Nemotron 3.5 Lightning", by: "NVIDIA", cats: ["thinking"], out: 16000, desc: "Reasoning model" },
  { provider: "nvidia", model: "google/gemma-4-31b-it", name: "Gemma 4 31B", by: "NVIDIA", cats: ["fast"], out: 8000, desc: "Google open model" },
].map((m) => ({ ...m, id: `${m.provider}:${m.model}` }));

// custom OpenAI-compatible endpoint models from env (OPENAI_COMPAT_MODELS="id|Name,id2|Name2")
for (const spec of CFG.providers.custom?.models || []) {
  CATALOG.push({ provider: "custom", model: spec.id, name: spec.name, by: CFG.providers.custom.label, cats: ["deep"], out: 16000, desc: "Your OpenAI-compatible endpoint", id: `custom:${spec.id}` });
}

const byId = (id) => CATALOG.find((m) => m.id === id);
const configured = (m) => !!CFG.providers[m.provider];

// ----------------------------------------------------------------- presets (fallback chains)
const ENV_LIST = (k) => (process.env[k] ? process.env[k].split(",").map((s) => s.trim()).filter(Boolean) : null);
const CHAINS = {
  // Groq first (LPU speed: a full 16k-token build in ~30-45s). Each Groq model has its own TPM bucket, so rotating
  // across the three keeps a free key productive; NVIDIA NIM is the deep fallback.
  build: ENV_LIST("STAK_CHAIN_BUILD") || ["groq:openai/gpt-oss-120b", "groq:qwen/qwen3.8-27b", "nvidia:mistralai/mistral-large-4-1t-a52b", "nvidia:google/gemma-4-31b-it", "groq:openai/gpt-oss-20b", "nvidia:minimaxai/minimax-m3.1-flash", "nvidia:poolside/laguna-xs-2.1", "nvidia:nvidia/nemotron-3-ultra-550b-a55b"],
  plan: ENV_LIST("STAK_CHAIN_PLAN") || ["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b", "groq:qwen/qwen3.8-27b", "nvidia:google/gemma-4-31b-it", "nvidia:nvidia/nemotron-3-ultra-550b-a55b", "nvidia:poolside/laguna-xs-2.1"],
  // runtime AI inside generated apps (chatbots etc): quality first, still sub-second on Groq
  appchat: ENV_LIST("STAK_CHAIN_APPCHAT") || ["groq:openai/gpt-oss-120b", "groq:qwen/qwen3.8-27b", "groq:openai/gpt-oss-20b", "nvidia:google/gemma-4-31b-it", "nvidia:nvidia/nemotron-3-ultra-550b-a55b"],
  fast: ENV_LIST("STAK_CHAIN_FAST") || ["groq:openai/gpt-oss-20b", "groq:openai/gpt-oss-120b", "groq:qwen/qwen3.8-27b", "nvidia:poolside/laguna-xs-2.1", "nvidia:nvidia/nemotron-3-ultra-550b-a55b"],
  quick: ENV_LIST("STAK_CHAIN_QUICK") || ["groq:openai/gpt-oss-20b", "groq:qwen/qwen3.8-27b", "groq:openai/gpt-oss-120b", "nvidia:poolside/laguna-xs-2.1", "nvidia:nvidia/nemotron-3-ultra-550b-a55b"],
};
if (CFG.providers.custom) for (const k of Object.keys(CHAINS)) CHAINS[k].push(...CATALOG.filter((m) => m.provider === "custom").map((m) => m.id));

const PRESETS = [
  { id: "stak:pro", name: "Stak Pro", categories: ["deep"], desc: "Deep, production-grade full-stack builds — the best default", sub: "GPT-OSS 120B · Qwen 3.8 · Nemotron 3 Ultra — auto-fallback", chains: { build: "build", fast: "fast", plan: "plan" }, effort: { build: "medium", fast: "low", plan: "high" } },
  { id: "stak:think", name: "Stak Think", categories: ["thinking"], desc: "Researches + plans the whole app first, then builds it", sub: "High reasoning plan → full build · best for complex apps", chains: { build: "build", fast: "fast", plan: "plan" }, effort: { build: "high", fast: "low", plan: "high" }, plan: true },
  { id: "stak:fast", name: "Stak Fast", categories: ["fast"], desc: "Quick drafts and small edits in seconds", sub: "GPT-OSS 20B · Qwen 3.8 · Laguna XS — quick drafts", chains: { build: "quick", fast: "fast", plan: "quick", appchat: "appchat" }, effort: { build: "low", fast: "low", plan: "low", appchat: "low" } },
];

// ----------------------------------------------------------------- health (circuit breaker)
// A model that errors gets cooled down; chains skip cooled models. Periodic probe refreshes availability.
const health = new Map(); // id -> { ok, until, fails, lastError, checked, ms }
const cooled = (id) => { const h = health.get(id); return h && h.until > Date.now(); };
function markFail(id, err) {
  const h = health.get(id) || { fails: 0 };
  h.fails = (h.fails || 0) + 1; h.ok = false; h.lastError = String(err?.message || err).slice(0, 200);
  const status = Number(err?.status || 0);
  const ms = status === 404 || status === 410 ? 6 * 3600e3 : status === 429 ? Math.min(90e3, Math.max(5, err.retryAfter || 20) * 1000) : Math.min(15 * 60e3, 30e3 * 2 ** Math.min(h.fails - 1, 5));
  h.until = Date.now() + ms; health.set(id, h);
}
function markOk(id, ms) { health.set(id, { ok: true, fails: 0, until: 0, checked: Date.now(), ms }); }

async function probeModel(m) {
  const t = Date.now();
  try {
    const r = await chat({ provider: m.provider, model: m.model, messages: [{ role: "user", content: "Reply with exactly: OK" }], maxTokens: 64, temperature: 0, timeoutMs: 25000, reasoning: m.reasoning ? "low" : null });
    if (!/ok/i.test(r.text + r.thinking)) throw new Error("bad reply");
    markOk(m.id, Date.now() - t); return true;
  } catch (e) { markFail(m.id, e); return false; }
}
// ask each provider which models this key can actually use; unknown ones are parked for 6h (not shown, not tried)
async function listProviderModels(name) {
  const p = CFG.providers[name];
  try {
    const r = await fetch(p.baseUrl + "/models", { headers: p.proxyKey ? { "x-api-key": p.proxyKey } : { Authorization: `Bearer ${p.apiKey}` }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const j = await r.json();
    return new Set((j.data || []).map((m) => m.id));
  } catch { return null; }
}
async function refreshHealth() {
  for (const name of Object.keys(CFG.providers)) {
    if (name === "custom") continue;
    const ids = await listProviderModels(name);
    if (!ids) continue;
    for (const m of CATALOG.filter((x) => x.provider === name)) if (!ids.has(m.model)) health.set(m.id, { ok: false, fails: 1, until: Date.now() + 6 * 3600e3, lastError: "not available for this key", missing: true });
  }
  const list = CATALOG.filter((m) => configured(m) && !health.get(m.id)?.missing);
  for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map(probeModel));
  const ok = list.filter((m) => health.get(m.id)?.ok).map((m) => m.name);
  console.log(`[llm] healthy models: ${ok.join(", ") || "none"}`);
}

// ----------------------------------------------------------------- transport
function endpoint(provider) {
  const p = CFG.providers[provider];
  if (!p) throw Object.assign(new Error(`Provider "${provider}" is not configured`), { status: 0 });
  return p;
}

// Low-level streaming call. Returns { text, thinking, ttftMs, tps, stop, tools }.
async function streamOpenAI({ baseUrl, apiKey, headers: extraHeaders, model, system, messages, maxTokens = 16000, temperature = 0.6, onText, onThinking, signal, timeoutMs = 300000, reasoning = null, tools = null, toolChoice = null, idleMs = 90000 }) {
  const ac = new AbortController();
  let timer = setTimeout(() => ac.abort(new Error("Model timed out")), timeoutMs);
  let idle = null;
  const bump = () => { clearTimeout(idle); idle = setTimeout(() => ac.abort(new Error("Model stopped responding")), idleMs); };
  if (signal) signal.addEventListener("abort", () => ac.abort(signal.reason));
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const msgs = [...(system ? [{ role: "system", content: system }] : []), ...messages];
  const body = { model, messages: msgs, stream: true, max_tokens: maxTokens, temperature, stream_options: { include_usage: true } };
  if (reasoning) body.reasoning_effort = reasoning;
  if (tools) { body.tools = tools; if (toolChoice) body.tool_choice = toolChoice; }
  let res;
  try {
    bump();
    res = await fetch(url, {
      method: "POST", signal: ac.signal,
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...(extraHeaders || {}) },
      body: JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(timer); clearTimeout(idle);
    if (signal?.aborted) throw Object.assign(new Error("Stopped"), { name: "AbortError", aborted: true });
    throw Object.assign(new Error("Could not reach model: " + (e.message || e)), { status: 0 });
  }
  if (!res.ok) {
    clearTimeout(timer); clearTimeout(idle);
    const t = await res.text().catch(() => "");
    let m = t; try { const j = JSON.parse(t); m = j.error?.message || j.message || j.detail || t; } catch {}
    const reset = String(res.headers.get("x-ratelimit-reset-tokens") || ""); // e.g. "7.66s" or "1m2.5s"
    const resetS = (/(\d+)m/.exec(reset)?.[1] || 0) * 60 + Number(/([\d.]+)s/.exec(reset)?.[1] || 0);
    const hinted = Number(/try again in ([\d.]+)s/i.exec(String(m))?.[1] || 0);
    throw Object.assign(new Error(`${res.status} ${String(m || res.statusText).slice(0, 300)}`), { status: res.status, retryAfter: Math.ceil(Number(res.headers.get("retry-after")) || resetS || hinted || 0) });
  }
  let out = "", think = "", inThink = false, buf = "", firstAt = 0, tokens = 0, stop = null, toolsOut = null, usage = null;
  const started = Date.now();
  const dec = new TextDecoder();
  const handleContent = (c) => {
    let s = c; // strip inline <think>…</think> some models emit
    while (s.length) {
      if (inThink) {
        const e = s.indexOf("</think>");
        if (e < 0) { think += s; onThinking && onThinking(think); s = ""; }
        else { think += s.slice(0, e); inThink = false; s = s.slice(e + 8); }
      } else {
        const b = s.indexOf("<think>");
        if (b < 0) { out += s; onText && onText(s, out); s = ""; }
        else { const pre = s.slice(0, b); if (pre) { out += pre; onText && onText(pre, out); } inThink = true; s = s.slice(b + 7); }
      }
    }
  };
  try {
    for await (const chunk of res.body) {
      bump();
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        if (j.error) throw Object.assign(new Error(j.error.message || "Model error"), { status: 500 });
        const ch = j.choices?.[0] || {};
        const d = ch.delta || {};
        const r = d.reasoning_content || d.reasoning;
        if (r) { if (!firstAt) firstAt = Date.now(); think += r; tokens++; onThinking && onThinking(think); }
        if (d.content) { if (!firstAt) firstAt = Date.now(); tokens++; handleContent(d.content); }
        if (d.executed_tools) toolsOut = (toolsOut || []).concat(d.executed_tools);
        if (ch.finish_reason) stop = ch.finish_reason;
        const u = j.usage || j.x_groq?.usage;
        if (u?.completion_tokens) { tokens = Math.max(tokens, u.completion_tokens); usage = { prompt: u.prompt_tokens || 0, completion: u.completion_tokens || 0 }; }
      }
    }
  } catch (e) {
    if (signal?.aborted) throw Object.assign(new Error("Stopped"), { name: "AbortError", aborted: true, partial: out });
    throw Object.assign(new Error(e.message || "Stream failed"), { status: e.status || 502, partial: out });
  } finally { clearTimeout(timer); clearTimeout(idle); }
  const secs = Math.max(0.1, (Date.now() - (firstAt || started)) / 1000);
  const estTokens = Math.max(tokens, Math.round((out.length + think.length) / 4));
  return { text: out, thinking: think, ttftMs: firstAt ? firstAt - started : 0, tps: Math.round(estTokens / secs), stop: stop === "length" ? "max_tokens" : stop, tools: toolsOut,
    usage: usage || { prompt: Math.round(msgs.reduce((n, x) => n + String(x.content || "").length, 0) / 3.8), completion: estTokens, estimated: true } };
}

// call a catalog/provider model
function chat({ provider, model, __direct, ...opts }) {
  if (__direct) return streamOpenAI({ ...opts, baseUrl: __direct.baseUrl, apiKey: __direct.apiKey, model: __direct.model });
  const p = endpoint(provider);
  return streamOpenAI({ ...opts, baseUrl: p.baseUrl, apiKey: p.proxyKey ? null : p.apiKey, headers: p.proxyKey ? { "x-api-key": p.proxyKey } : null, model });
}

// ----------------------------------------------------------------- resolution
function builtin(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (p) return p;
  const m = byId(id);
  if (m && configured(m)) return { id: m.id, name: `${m.name}`, single: m, categories: m.cats };
  return null;
}

// ---- tokens-per-minute budget (Groq free keys: ~8k tokens/min per model; a prompt larger than that is rejected with 413)
const ledger = new Map(); // id -> [{t, n}]
const estTokens = (msgs, system) => Math.ceil(((system || "").length + (msgs || []).reduce((n, m) => n + String(typeof m.content === "string" ? m.content : JSON.stringify(m.content || "")).length, 0)) / 3.6);
function tpmOf(c) { return CFG.providers[c.provider]?.tpm || 0; }
function usedLastMinute(id) { const now = Date.now(); const a = (ledger.get(id) || []).filter((x) => now - x.t < 60e3); ledger.set(id, a); return a.reduce((n, x) => n + x.n, 0); }
function spend(id, n) { const a = ledger.get(id) || []; a.push({ t: Date.now(), n }); ledger.set(id, a); }
// "fits" | "wait" (fits after the window drains) | "never" (request bigger than the bucket)
function budget(c, need) { const tpm = tpmOf(c); if (!tpm) return "fits"; if (need > tpm) return "never"; return usedLastMinute(c.id) + need <= tpm ? "fits" : "wait"; }

// candidate list for a builtin selection + role
function candidates(sel, role) {
  const r = role === "plan" ? "plan" : role === "fast" ? "fast" : "build";
  let ids;
  if (role === "appchat") ids = CHAINS.appchat;
  else if (sel.single) ids = [sel.single.id, ...CHAINS[r === "fast" ? "fast" : "build"]];
  else ids = CHAINS[sel.chains[r]] || CHAINS.build;
  const seen = new Set();
  const list = ids.map(byId).filter((m) => m && configured(m) && !seen.has(m.id) && seen.add(m.id));
  const warm = list.filter((m) => !cooled(m.id));
  return warm.length ? [...warm, ...list.filter((m) => cooled(m.id))] : list; // if everything is cooled, still try in order
}

const retryable = (e) => !e.status || e.status === 408 || e.status === 413 || e.status === 409 || e.status === 429 || e.status >= 500 || e.status === 404 || e.status === 410 || e.status === 400 || /timed out|stopped responding|reach model|prematurely|terminated|socket/i.test(e.message);

// One model, with automatic CONTINUATION: if the stream is cut (proxy/socket limits, idle timeouts) or hits max_tokens
// after producing real output, ask the same model to continue exactly where it stopped and stitch the text together.
const CONT_PROMPT = "Your previous reply was cut off. Continue EXACTLY from the last character you wrote — do not repeat anything, do not restart files, no preamble. Output only the continuation.";
const cutErr = (e) => /terminated|socket|stopped responding|timed out|prematurely|ECONNRESET|other side closed|aborted/i.test(String(e?.message || "") + String(e?.cause?.code || ""));
async function streamWithContinuation(c, opts, extra) {
  let acc = "", thinking = "", conts = 0, last = null; const usage = { prompt: 0, completion: 0 };
  const maxConts = opts.maxContinuations ?? (opts.role === "build" ? 8 : 2);
  for (;;) {
    let buf = "", flushed = conts === 0;
    const emit = (t) => { acc += t; opts.onText && opts.onText(t, acc); };
    const onText = (t) => {
      extra.streamed();
      if (flushed) return emit(t);
      buf += t;
      if (buf.length < 400) return;
      flushed = true;
      let k = Math.min(400, buf.length);
      for (; k >= 12; k--) if (acc.endsWith(buf.slice(0, k))) break;
      emit(k >= 12 ? buf.slice(k) : buf);
    };
    const messages = conts ? [...opts.messages, { role: "assistant", content: acc }, { role: "user", content: CONT_PROMPT }] : opts.messages;
    try {
      const r = await chat({ ...opts, ...extra.call, messages, onText });
      if (!flushed) { flushed = true; let k = Math.min(400, buf.length); for (; k >= 12; k--) if (acc.endsWith(buf.slice(0, k))) break; emit(k >= 12 ? buf.slice(k) : buf); }
      thinking += r.thinking || "";
      last = r; usage.prompt += r.usage?.prompt || 0; usage.completion += r.usage?.completion || 0;
      if (r.stop === "max_tokens" && acc.length > 800 && conts < maxConts && opts.continuable !== false) { conts++; continue; }
      return { ...r, text: acc, thinking, continuations: conts, usage };
    } catch (e) {
      if (!flushed && buf) { flushed = true; emit(buf); }
      if (e.aborted) throw Object.assign(e, { partial: acc });
      if (acc.length > 1500 && conts < maxConts && opts.continuable !== false && cutErr(e)) { conts++; console.warn(`[llm] ${c.id} cut after ${acc.length} chars — continuing (${conts})`); continue; }
      throw Object.assign(e, { partial: acc });
    }
  }
  void last;
}

// unified: m = { kind: "builtin", id } | { kind: "user", baseUrl, apiKey, model }
// opts.onRestart(candidate) is called before a fallback attempt if the previous one already streamed text.
async function stream(m, opts) {
  if (m.kind === "user") {
    const c = { id: `user:${m.model}`, provider: null };
    const call = { baseUrl: m.baseUrl, apiKey: m.apiKey, model: m.model };
    return streamWithContinuationUser(c, opts, call);
  }
  const sel = builtin(m.id) || PRESETS[0];
  const role = opts.role || "build";
  const list = candidates(sel, role).filter((c) => !health.get(c.id)?.missing);
  if (!list.length) throw Object.assign(new Error("No AI provider is configured on this server (set GROQ_API_KEY and/or NVIDIA_API_KEY)"), { status: 503 });
  let lastErr = null, streamed = false, waited = 0;
  const maxAttempts = Math.min(list.length + 1, opts.maxAttempts || 5);
  const queue = list.slice();
  const promptTok = estTokens(opts.messages, opts.system);
  // order by budget: models whose TPM bucket can take this request now go first; too-big requests skip that model entirely
  // TPM-limited providers (Groq free = 8k/min): a request whose PROMPT exceeds the bucket gets a 413, so route it elsewhere.
  // (Measured: Groq does not charge max_tokens up-front — a tiny prompt with max_tokens 20000 succeeds on an 8k key.)
  const mtFor = (c) => Math.min(opts.maxTokens || 16000, c.out || 16000);
  const plan = queue.map((c) => ({ c, st: budget(c, promptTok + 600) }));
  const fitsAny = plan.some((p) => p.st !== "never");
  queue.length = 0;
  for (const st of ["fits", "wait"]) for (const p of plan) if (p.st === st) queue.push(p.c);
  if (!fitsAny || !queue.length) queue.push(...plan.map((p) => p.c)); // nothing fits: try anyway in order (the provider decides)
  for (let i = 0; i < maxAttempts && queue.length; i++) {
    const c = queue.shift();
    if (streamed && opts.onRestart) { try { opts.onRestart(c); } catch {} }
    streamed = false;
    const effort = c.reasoning ? (opts.reasoning || sel.effort?.[role] || (role === "fast" || role === "appchat" ? "low" : "medium")) : null;
    const t0 = Date.now();
    try {
      const r = await streamWithContinuation(c, opts, {
        streamed: () => { streamed = true; },
        call: { provider: c.provider, model: c.model, reasoning: effort, maxTokens: mtFor(c) },
      });
      if (!r.text.trim() && !opts.allowEmpty) throw Object.assign(new Error("Empty response"), { status: 502 });
      const why = opts.validate ? opts.validate(r.text, r) : null; // output-shape check: unusable output falls through to the next model
      if (why) throw Object.assign(new Error(why), { status: 502, invalid: true, head: r.text.slice(0, 240) });
      markOk(c.id, Date.now() - t0);
      if (tpmOf(c)) spend(c.id, (r.usage?.prompt || promptTok) + (r.usage?.completion || 0));
      r.modelId = c.id; r.modelName = `${c.name} · ${c.by}`;
      if (i > 0 && opts.onFallback) opts.onFallback(c, lastErr);
      return r;
    } catch (e) {
      if (e.aborted || opts.signal?.aborted) throw Object.assign(e, { aborted: true }); // user pressed Stop: never retry, never blame the model
      lastErr = e;
      console.warn(`[llm] ${c.id} failed (${role}): ${String(e.message).slice(0, 160)}${e.head ? ` · output began: ${JSON.stringify(e.head)}` : ""}`);
      if (!retryable(e)) { markFail(c.id, e); throw e; }
      // rate limit: if this was the last option and the wait is short, wait once and retry the same model
      if (e.status === 429 && !queue.some((q) => !cooled(q.id)) && waited < 45 && (e.retryAfter || 10) <= 30) {
        const w = Math.max(2, e.retryAfter || 10); waited += w;
        opts.onWait && opts.onWait(c, w);
        await new Promise((r) => { const t = setTimeout(r, w * 1000); opts.signal?.addEventListener("abort", () => { clearTimeout(t); r(); }); });
        if (opts.signal?.aborted) throw Object.assign(new Error("Stopped"), { aborted: true });
        queue.unshift(c); continue;
      }
      if (e.status === 413) spend(c.id, tpmOf(c) || 0); // request too large for this bucket right now — skip, don't blame the model
      else if (!e.invalid) markFail(c.id, e);
      if (e.status === 429 && tpmOf(c)) spend(c.id, tpmOf(c));
    }
  }
  throw lastErr || new Error("All models failed");
}
// user models (own key): same continuation logic, direct endpoint
function streamWithContinuationUser(c, opts, call) {
  const direct = { ...opts };
  return streamWithContinuation(c, direct, { streamed: () => {}, call: { __direct: call } });
}

async function complete(m, opts) {
  const r = await stream(m, { ...opts, onText: null });
  return r.text;
}

// robust JSON extraction
function parseJSON(text) {
  if (!text) return null;
  let s = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return null;
}

// what /api/models shows as "built-in"
function builtinList() {
  const avail = (m) => configured(m) && !health.get(m.id)?.missing;
  const presets = PRESETS.map(({ id, name, categories, desc, sub }) => ({ id, name, categories, desc, sub }));
  const singles = CATALOG.filter(avail).map((m) => {
    const h = health.get(m.id);
    return { id: m.id, name: `${m.name} · ${m.by}`, categories: m.cats, desc: m.desc, sub: `${m.by} · ${m.model}${h?.ms ? ` · ${(h.ms / 1000).toFixed(1)}s ping` : ""}${m.search ? " · web search" : ""}` };
  });
  return [...presets, ...singles];
}
function status() {
  return {
    providers: Object.fromEntries(Object.entries(CFG.providers).map(([k, v]) => [k, { configured: true, label: v.label }])),
    models: CATALOG.filter(configured).map((m) => ({ id: m.id, ok: health.get(m.id)?.ok ?? null, ms: health.get(m.id)?.ms || null, error: health.get(m.id)?.ok === false ? health.get(m.id).lastError : undefined })),
  };
}

const BUILTIN = PRESETS; // back-compat export
module.exports = { budget, estTokens, BUILTIN, PRESETS, CATALOG, CHAINS, builtin, builtinList, stream, complete, chat, streamOpenAI, parseJSON, refreshHealth, status, health, configured, byId };

// LLM layer — OpenAI-compatible Chat Completions + SSE streaming for three providers:
//   Groq (LPU speed), NVIDIA NIM (big open models), Google Gemini (OpenAI-compatible endpoint).
// There is no model picker: Stak routes every request automatically ("auto") by task type and prompt
// complexity, with health-checked fallback chains. Users only ever see "Stak".
const CFG = require("./config");

// ----------------------------------------------------------------- catalog
// out = max output tokens we request · effort = reasoning_effort we send (null = don't send)
const CATALOG = [
  // Google Gemini
  { provider: "gemini", model: "gemini-3.8-flash", name: "Gemini 3.8 Flash", out: 60000, effort: "low" },
  { provider: "gemini", model: "gemini-3.7-flash", name: "Gemini 3.7 Flash", out: 60000, effort: "low" },
  { provider: "gemini", model: "gemini-3.6-flash", name: "Gemini 3.6 Flash", out: 60000, effort: "low" },
  { provider: "gemini", model: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", out: 60000, effort: "low" },
  { provider: "gemini", model: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", out: 30000, effort: null },
  // Groq
  { provider: "groq", model: "openai/gpt-oss-120b", name: "GPT-OSS 120B", out: 32000, effort: "low", search: true },
  { provider: "groq", model: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B", out: 16384, effort: null },
  { provider: "groq", model: "openai/gpt-oss-20b", name: "GPT-OSS 20B", out: 32000, effort: "low", search: true },
  // NVIDIA NIM
  { provider: "nvidia", model: "moonshotai/kimi-k2.6", name: "Kimi K2.6", out: 32000, effort: null },
  { provider: "nvidia", model: "deepseek-ai/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", out: 32000, effort: null },
  { provider: "nvidia", model: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash", out: 32000, effort: null },
  { provider: "nvidia", model: "minimaxai/minimax-m3.1-flash", name: "MiniMax M3.1 Flash", out: 32000, effort: null },
  { provider: "nvidia", model: "mistralai/mistral-large-4-1t-a52b", name: "Mistral Large 4", out: 16000, effort: null },
  { provider: "nvidia", model: "nvidia/nemotron-3-super-120b-a12b", name: "Nemotron 3 Super", out: 16000, effort: null },
].map((m) => ({ ...m, id: `${m.provider}:${m.model}` }));

const byId = (id) => CATALOG.find((m) => m.id === id);
const configured = (m) => !!CFG.providers[m.provider];

// ----------------------------------------------------------------- auto routing chains
const ENV_LIST = (k) => (process.env[k] ? process.env[k].split(",").map((s) => s.trim()).filter(Boolean) : null);
const CHAINS = {
  // full builds of real apps (tools, dashboards, games, CRUD, auth)
  app: ENV_LIST("STAK_CHAIN_APP") || ["gemini:gemini-3.8-flash", "nvidia:moonshotai/kimi-k2.6", "gemini:gemini-3.6-flash", "groq:openai/gpt-oss-120b", "nvidia:deepseek-ai/deepseek-v4.1-flash", "nvidia:z-ai/glm-5.3-flash", "nvidia:minimaxai/minimax-m3.1-flash"],
  // simpler websites / landing pages / single-purpose tools
  site: ENV_LIST("STAK_CHAIN_SITE") || ["gemini:gemini-3.8-flash", "groq:openai/gpt-oss-120b", "nvidia:moonshotai/kimi-k2.6", "gemini:gemini-3.6-flash", "nvidia:z-ai/glm-5.3-flash", "nvidia:minimaxai/minimax-m3.1-flash"],
  // edits (SEARCH/REPLACE patches) — speed matters most
  edit: ENV_LIST("STAK_CHAIN_EDIT") || ["gemini:gemini-3.8-flash", "groq:openai/gpt-oss-120b", "nvidia:moonshotai/kimi-k2.6", "gemini:gemini-3.6-flash", "nvidia:deepseek-ai/deepseek-v4.1-flash", "nvidia:z-ai/glm-5.3-flash"],
  // repairs of a single broken file
  repair: ENV_LIST("STAK_CHAIN_REPAIR") || ["gemini:gemini-3.8-flash", "groq:openai/gpt-oss-120b", "nvidia:moonshotai/kimi-k2.6", "gemini:gemini-3.6-flash", "nvidia:deepseek-ai/deepseek-v4.1-flash"],
  // questions JSON, chat answers, research summaries, generated-app chat
  fast: ENV_LIST("STAK_CHAIN_FAST") || ["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b", "gemini:gemini-3.5-flash-lite", "gemini:gemini-3.8-flash", "nvidia:z-ai/glm-5.3-flash", "nvidia:minimaxai/minimax-m3.1-flash"],
};
const ROLE_CHAIN = { build: "app", app: "app", site: "site", edit: "edit", repair: "repair", fast: "fast", plan: "fast", quick: "fast" };

// What kind of thing is the user asking for? Drives which chain a build uses.
const APP_RE = /\b(app|tool|dashboard|tracker|manager|crm|erp|inventory|todo|to-do|kanban|planner|calculator|converter|editor|game|quiz|chat|chatbot|login|sign ?in|signup|auth|admin|database|crud|booking system|pos|billing|invoice|expense|budget|habit|notes?|timer|pomodoro|scheduler|calendar|analytics|portal|lms|marketplace|e-?commerce|cart|checkout|realtime|real-time|multiplayer|leaderboard|generator|player|recorder|scanner|whiteboard|drawing|paint|spreadsheet|form builder|survey|poll|tic.?tac|snake|tetris|flappy|chess|sudoku|weather|crypto|stock|tracker)\b/i;
const SITE_RE = /\b(landing|website|site|portfolio|homepage|home page|marketing|brochure|blog|resume|cv|restaurant site|business site|agency|wedding|event page)\b/i;
const APP_RE_LOCAL = /(ऐप|एप|टूल|कैलकुलेटर|गेम|बिल|हिसाब|ट्रैकर|डैशबोर्ड|लिस्ट|खाता|रजिस्टर|मैनेज|\b(hisab|hisaab|khata|bill|bills|banao app|tracker)\b)/i;
const SITE_RE_LOCAL = /(वेबसाइट|साइट|लैंडिंग|पोर्टफोलियो|\bwebsite\b)/i;
function classify(text) {
  const s = String(text || "");
  const app = APP_RE.test(s) || APP_RE_LOCAL.test(s), site = SITE_RE.test(s) || SITE_RE_LOCAL.test(s);
  if (app && !/\blanding\b|लैंडिंग/i.test(s)) return "app";
  if (site) return "site";
  return "app"; // unclear → build something that actually works
}

// ----------------------------------------------------------------- health (circuit breaker)
const health = new Map(); // id -> { ok, until, fails, lastError, checked, ms }
const cooled = (id) => { const h = health.get(id); return h && h.until > Date.now(); };
function markFail(id, err) {
  const h = health.get(id) || { fails: 0 };
  h.fails = (h.fails || 0) + 1; h.ok = false; h.lastError = String(err?.message || err).slice(0, 200);
  const status = Number(err?.status || 0);
  const ms = status === 404 || status === 410 ? 6 * 3600e3 : status === 401 || status === 403 ? 30 * 60e3 : status === 429 ? Math.min(120e3, (err.retryAfter || 20) * 1000) : status === 503 || /stopped responding|timed out/i.test(String(err?.message)) ? 180e3 : Math.min(10 * 60e3, 20e3 * 2 ** Math.min(h.fails - 1, 5));
  h.until = Date.now() + ms; health.set(id, h);
}
function markOk(id, ms) { health.set(id, { ok: true, fails: 0, until: 0, checked: Date.now(), ms }); }

async function probeModel(m) {
  const t = Date.now();
  try {
    const r = await chat({ provider: m.provider, model: m.model, messages: [{ role: "user", content: "Reply with exactly: OK" }], maxTokens: 400, temperature: 0, timeoutMs: 25000, reasoning: m.effort ? "low" : null });
    if (!/ok/i.test(r.text + r.thinking)) throw new Error("bad reply");
    markOk(m.id, Date.now() - t); return { ok: true, ms: Date.now() - t };
  } catch (e) { markFail(m.id, e); return { ok: false, error: e.message, ms: Date.now() - t }; }
}
async function refreshHealth() {
  const list = CATALOG.filter(configured);
  const out = {};
  for (let i = 0; i < list.length; i += 4) {
    const rs = await Promise.all(list.slice(i, i + 4).map(probeModel));
    rs.forEach((r, k) => { out[list[i + k].id] = r; });
  }
  return out;
}

// ----------------------------------------------------------------- transport
function endpoint(provider) {
  const p = CFG.providers[provider];
  if (!p) throw Object.assign(new Error(`Provider "${provider}" is not configured`), { status: 0 });
  return p;
}
const stoppedErr = () => Object.assign(new Error("Stopped by user"), { stopped: true, status: 499 });

// Low-level streaming call. Returns { text, thinking, ttftMs, tps, stop, tools }.
async function streamOpenAI({ baseUrl, apiKey, headers: extraHeaders, model, system, messages, maxTokens = 16000, temperature = 0.6, onText, onThinking, signal, timeoutMs = 280000, reasoning = null, tools = null, toolChoice = null, idleMs = 75000, extraBody = null }) {
  if (signal?.aborted) throw stoppedErr();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("Model timed out")), timeoutMs);
  let idle = null;
  let gotData = false; // until the first bytes arrive, give up fast so the next engine can take over
  const bump = (data) => { if (data) gotData = true; clearTimeout(idle); idle = setTimeout(() => ac.abort(new Error("Model stopped responding")), gotData ? idleMs : Math.min(idleMs, 30000)); };
  const onAbort = () => ac.abort(stoppedErr());
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const msgs = [...(system ? [{ role: "system", content: system }] : []), ...messages];
  const body = { model, messages: msgs, stream: true, max_tokens: maxTokens, temperature, ...(extraBody || {}) };
  if (reasoning) body.reasoning_effort = reasoning;
  if (tools) { body.tools = tools; if (toolChoice) body.tool_choice = toolChoice; }
  const cleanup = () => { clearTimeout(timer); clearTimeout(idle); if (signal) signal.removeEventListener("abort", onAbort); };
  let res;
  try {
    bump();
    res = await fetch(url, {
      method: "POST", signal: ac.signal,
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...(extraHeaders || {}) },
      body: JSON.stringify(body),
    });
  } catch (e) {
    cleanup();
    if (signal?.aborted) throw stoppedErr();
    throw Object.assign(new Error("Could not reach model: " + (e.cause?.message || e.message || e)), { status: 0 });
  }
  if (!res.ok) {
    cleanup();
    const t = await res.text().catch(() => "");
    let m = t; try { const j = JSON.parse(t); const x = Array.isArray(j) ? j[0] : j; m = x.error?.message || x.message || x.detail || t; } catch {}
    throw Object.assign(new Error(`${res.status} ${String(m || res.statusText).slice(0, 300)}`), { status: res.status, retryAfter: Number(res.headers.get("retry-after")) || 0 });
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
      bump(true);
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        if (j.error) throw Object.assign(new Error(j.error.message || "Model error"), { status: Number(j.error.code) || 500 });
        const ch = j.choices?.[0] || {};
        const d = ch.delta || {};
        const r = d.reasoning_content || d.reasoning;
        if (r) { if (!firstAt) firstAt = Date.now(); think += r; tokens++; onThinking && onThinking(think); }
        if (d.content) { if (!firstAt) firstAt = Date.now(); tokens++; handleContent(d.content); }
        if (d.executed_tools) toolsOut = (toolsOut || []).concat(d.executed_tools);
        if (ch.finish_reason) stop = ch.finish_reason;
        if (j.usage) usage = j.usage;
        if (j.usage?.completion_tokens) tokens = Math.max(tokens, j.usage.completion_tokens);
        if (j.x_groq?.usage?.completion_tokens) { tokens = Math.max(tokens, j.x_groq.usage.completion_tokens); usage = j.x_groq.usage; }
      }
    }
  } catch (e) {
    if (signal?.aborted || e?.stopped) throw Object.assign(stoppedErr(), { partial: out });
    throw Object.assign(new Error(e.message || "Stream failed"), { status: e.status || 502, partial: out });
  } finally { cleanup(); }
  const secs = Math.max(0.1, (Date.now() - (firstAt || started)) / 1000);
  const estTokens = Math.max(tokens, Math.round((out.length + think.length) / 4));
  return { text: out, thinking: think, ttftMs: firstAt ? firstAt - started : 0, tps: Math.round(estTokens / secs), stop: stop === "length" ? "max_tokens" : stop, tools: toolsOut, usage, ms: Date.now() - started };
}

// Native Gemini streaming (generateContent + SSE). Works with the x-goog-api-key header (and proxies that inject it).
async function streamGemini({ baseUrl, apiKey, model, system, messages, maxTokens = 16000, temperature = 0.6, onText, onThinking, signal, timeoutMs = 280000, idleMs = 75000, reasoning = null }) {
  if (signal?.aborted) throw stoppedErr();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("Model timed out")), timeoutMs);
  let idle = null;
  let gotData = false; // until the first bytes arrive, give up fast so the next engine can take over
  const bump = (data) => { if (data) gotData = true; clearTimeout(idle); idle = setTimeout(() => ac.abort(new Error("Model stopped responding")), gotData ? idleMs : Math.min(idleMs, 30000)); };
  const onAbort = () => ac.abort(stoppedErr());
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  const cleanup = () => { clearTimeout(timer); clearTimeout(idle); if (signal) signal.removeEventListener("abort", onAbort); };
  const root = baseUrl.replace(/\/openai\/?$/, "").replace(/\/+$/, "");
  const url = `${root}/models/${model}:streamGenerateContent?alt=sse`;
  const contents = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content || "") }] }));
  const gen = { maxOutputTokens: maxTokens, temperature };
  if (/gemini-3|gemini-4/.test(model)) gen.thinkingConfig = { thinkingLevel: reasoning === "high" ? "high" : "low", includeThoughts: false };
  const body = { contents, generationConfig: gen, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}) };
  let res;
  try {
    bump();
    res = await fetch(url, { method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json", ...(apiKey ? { "x-goog-api-key": apiKey } : {}) }, body: JSON.stringify(body) });
  } catch (e) {
    cleanup();
    if (signal?.aborted) throw stoppedErr();
    throw Object.assign(new Error("Could not reach model: " + (e.cause?.message || e.message || e)), { status: 0 });
  }
  if (!res.ok) {
    cleanup();
    const t = await res.text().catch(() => "");
    let m = t; try { const j = JSON.parse(t); const x = Array.isArray(j) ? j[0] : j; m = x.error?.message || t; } catch {}
    throw Object.assign(new Error(`${res.status} ${String(m || res.statusText).slice(0, 300)}`), { status: res.status, retryAfter: Number(res.headers.get("retry-after")) || 0 });
  }
  let out = "", buf = "", firstAt = 0, stop = null, usage = null;
  const started = Date.now(), dec = new TextDecoder();
  try {
    for await (const chunk of res.body) {
      bump(true);
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        let j; try { j = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (j.error) throw Object.assign(new Error(j.error.message || "Model error"), { status: Number(j.error.code) || 500 });
        const cand = j.candidates?.[0];
        for (const part of cand?.content?.parts || []) {
          if (!part.text) continue;
          if (!firstAt) firstAt = Date.now();
          if (part.thought) { onThinking && onThinking(part.text); continue; }
          out += part.text; onText && onText(part.text, out);
        }
        if (cand?.finishReason) stop = cand.finishReason;
        if (j.usageMetadata) usage = j.usageMetadata;
      }
    }
  } catch (e) {
    if (signal?.aborted || e?.stopped) throw Object.assign(stoppedErr(), { partial: out });
    throw Object.assign(new Error(e.message || "Stream failed"), { status: e.status || 502, partial: out });
  } finally { cleanup(); }
  const secs = Math.max(0.1, (Date.now() - (firstAt || started)) / 1000);
  const tokens = usage?.candidatesTokenCount || Math.round(out.length / 4);
  return { text: out, thinking: "", ttftMs: firstAt ? firstAt - started : 0, tps: Math.round(tokens / secs), stop: stop === "MAX_TOKENS" ? "max_tokens" : (stop || "").toLowerCase(), tools: null, usage, ms: Date.now() - started };
}

// call a catalog/provider model
function chat({ provider, model, ...opts }) {
  const p = endpoint(provider);
  const headers = {};
  let apiKey = p.apiKey;
  if (p.proxied) apiKey = null; // the outbound proxy adds the credential
  const extraBody = {};
  if (provider === "gemini") return streamGemini({ ...opts, baseUrl: p.baseUrl, apiKey, model });
  return streamOpenAI({ ...opts, baseUrl: p.baseUrl, apiKey, headers, model, extraBody: { ...extraBody, ...(opts.extraBody || {}) } });
}

// ----------------------------------------------------------------- resolution
// candidate list for a role. opts.kind ("app"|"site") refines "build".
function candidates(role, kind) {
  let chain = ROLE_CHAIN[role] || "app";
  if (role === "build" && kind === "site") chain = "site";
  const ids = CHAINS[chain] || CHAINS.app;
  const seen = new Set();
  const list = ids.map(byId).filter((m) => m && configured(m) && !seen.has(m.id) && seen.add(m.id));
  // any configured model not in the chain is a last-resort fallback
  for (const m of CATALOG) if (configured(m) && !seen.has(m.id) && role !== "fast") { seen.add(m.id); list.push(m); }
  const warm = list.filter((m) => !cooled(m.id));
  return warm.length ? [...warm, ...list.filter((m) => cooled(m.id))] : list;
}

const retryable = (e) => !e.stopped && (!e.status || [400, 401, 403, 404, 408, 409, 410, 413, 422, 429].includes(e.status) || e.status >= 500 || /timed out|stopped responding|reach model|prematurely|terminated|socket/i.test(e.message));

// Free Groq keys have a small tokens-per-minute budget (prompt + max_tokens must fit). Skip models that can't fit the request.
const estTokens = (opts) => Math.ceil(((opts.system || "").length + (opts.messages || []).reduce((n, m) => n + String(m.content || "").length, 0)) / 3.6);
function fits(c, opts, role) {
  const tpm = CFG.providers[c.provider]?.tpm;
  const want = Math.min(opts.maxTokens || 16000, c.out || 16000);
  if (!tpm) return want;
  const room = tpm - estTokens(opts) - 300;
  const need = (role === "build" || role === "edit" || role === "repair") ? Math.min(want, 6000) : Math.min(want, 700);
  return room >= need ? Math.min(want, room) : 0;
}

// One model, with automatic CONTINUATION: if the stream is cut or hits max_tokens after producing real output,
// ask the same model to continue exactly where it stopped and stitch the text together.
const CONT_PROMPT = "Your previous reply was cut off. Continue EXACTLY from the last character you wrote — do not repeat anything, do not restart files, no preamble. Output only the continuation.";
const cutErr = (e) => !e?.stopped && /terminated|socket|stopped responding|timed out|prematurely|ECONNRESET|other side closed/i.test(String(e?.message || "") + String(e?.cause?.code || ""));
async function streamWithContinuation(c, opts, extra) {
  let acc = "", thinking = "", conts = 0;
  const maxConts = opts.maxContinuations ?? (opts.role === "build" ? 4 : 1);
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
      if (r.stop === "max_tokens" && acc.length > 800 && conts < maxConts && opts.continuable !== false && !(opts.deadline && Date.now() > opts.deadline - 30e3)) { conts++; continue; }
      return { ...r, text: acc, thinking, continuations: conts };
    } catch (e) {
      if (e.stopped || opts.signal?.aborted) throw Object.assign(stoppedErr(), { partial: acc });
      if (!flushed && buf) { flushed = true; emit(buf); }
      if (acc.length > 1500 && conts < maxConts && opts.continuable !== false && cutErr(e) && !(opts.deadline && Date.now() > opts.deadline - 30e3)) { conts++; console.warn(`[llm] ${c.id} cut after ${acc.length} chars — continuing (${conts})`); continue; }
      throw Object.assign(e, { partial: acc });
    }
  }
}

// m is ignored (kept for call-site compatibility): routing is automatic.
// opts.role: build|edit|repair|fast · opts.kind: app|site · opts.onRestart(candidate) before a fallback attempt that follows streamed text.
async function stream(_m, opts) {
  const role = opts.role || "build";
  const list = candidates(role, opts.kind).filter((c) => fits(c, opts, role) > 0);
  if (!list.length) throw Object.assign(new Error("No model provider is configured on this server (set GEMINI_API_KEY, GROQ_API_KEY and/or NVIDIA_API_KEY)"), { status: 503 });
  let lastErr = null, streamed = false;
  const maxAttempts = Math.min(list.length, opts.maxAttempts || 4);
  for (let i = 0; i < maxAttempts; i++) {
    if (opts.signal?.aborted) throw stoppedErr();
    if (opts.deadline && Date.now() > opts.deadline - 20e3 && i > 0) break;
    const c = list[i];
    if (streamed && opts.onRestart) { try { opts.onRestart(c); } catch {} }
    streamed = false;
    const t0 = Date.now();
    try {
      const timeoutMs = opts.deadline ? Math.max(20e3, Math.min(opts.timeoutMs || 280e3, opts.deadline - Date.now())) : opts.timeoutMs;
      const r = await streamWithContinuation(c, opts, {
        streamed: () => { streamed = true; },
        call: { provider: c.provider, model: c.model, reasoning: opts.reasoning !== undefined ? opts.reasoning : c.effort, maxTokens: fits(c, opts, role), timeoutMs },
      });
      if (!r.text.trim() && !opts.allowEmpty) throw Object.assign(new Error("Empty response"), { status: 502 });
      markOk(c.id, Date.now() - t0);
      r.modelId = c.id; r.modelName = c.name; r.provider = c.provider;
      console.log(`[llm] ${role}${opts.kind ? "/" + opts.kind : ""} ${c.id} ok in ${((Date.now() - t0) / 1000).toFixed(1)}s · ${r.text.length} chars · ${r.tps} tok/s · ttft ${r.ttftMs}ms${r.continuations ? ` · ${r.continuations} cont` : ""}`);
      if (i > 0 && opts.onFallback) opts.onFallback(c, lastErr);
      return r;
    } catch (e) {
      if (e.stopped || opts.signal?.aborted) throw Object.assign(stoppedErr(), { partial: e.partial });
      lastErr = e;
      console.warn(`[llm] ${c.id} failed (${role}) after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${String(e.message).slice(0, 200)}`);
      markFail(c.id, e);
      if (!retryable(e)) throw e;
    }
  }
  throw lastErr || new Error("All models failed");
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

// The UI's model menu only ever shows one entry: Stak (automatic).
const PRESETS = [{ id: "stak:auto", name: "Stak", categories: ["deep"], desc: "Picks the best engine for every request automatically", sub: "Automatic" }];
function builtin(id) { return PRESETS[0]; }
function builtinList() { return PRESETS.map(({ id, name, categories, desc, sub }) => ({ id, name, categories, desc, sub })); }
function status() {
  return {
    providers: Object.fromEntries(Object.entries(CFG.providers).map(([k, v]) => [k, { configured: true, label: v.label }])),
    models: CATALOG.filter(configured).map((m) => ({ id: m.id, ok: health.get(m.id)?.ok ?? null, ms: health.get(m.id)?.ms || null, error: health.get(m.id)?.ok === false ? health.get(m.id).lastError : undefined })),
  };
}

const BUILTIN = PRESETS;
module.exports = { BUILTIN, PRESETS, CATALOG, CHAINS, classify, candidates, builtin, builtinList, stream, complete, chat, streamOpenAI, parseJSON, refreshHealth, probeModel, status, health, configured, byId, markFail, markOk };

// Real-time web search & research.
//  research(): facts for a build/edit — Groq GPT-OSS built-in `browser_search` (live web, cited) when Groq is configured,
//              otherwise Tavily / Brave / Serper (if keys) or free DuckDuckGo Lite + page reader, summarised by the fast model.
//  search():   raw results list (used by stak.web.search() inside generated apps).
const CFG = require("./config");

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const { safeFetch } = require("./netsafe");
const tfetch = (url, opts = {}, ms = 15000) => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(t)); };
const decode = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- heuristics
const LIVE_RE = /\b(latest|today|tonight|current(ly)?|right now|live|news|price[sd]?|rates?|stock|share price|crypto|bitcoin|weather|score[sd]?|schedule|fixtures?|results?|election|release[sd]?|launch(ed)?|trending|this (week|month|year)|20(2[5-9]|3\d)|real[- ]?time|up[- ]?to[- ]?date|recent(ly)?|newest|search the web|look ?up|google it|research|aaj|abhi|taaza|taza|latest wala|khabar|samachar|bhav|keemat|dhundo|search karo|आज|अभी|ताज़ा|खबर|कीमत)\b/i;
const ENTITY_RE = /\b(official website|address|phone|opening hours|menu of|about (the )?company|wikipedia|statistics|facts about|population|founded)\b/i;
function needsResearch(text) { const s = String(text || ""); return LIVE_RE.test(s) || ENTITY_RE.test(s); }

// ---------------------------------------------------------------- providers (raw results)
async function ddg(q, limit = 6) {
  const out = [];
  try {
    const r = await tfetch("https://html.duckduckgo.com/html/", { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "Accept-Language": "en-IN,en;q=0.9" }, body: `q=${encodeURIComponent(q)}&kl=in-en` });
    const html = await r.text();
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) && out.length < limit) {
      let url = m[1]; const u = url.match(/uddg=([^&]+)/); if (u) url = decodeURIComponent(u[1]);
      if (url.startsWith("//")) url = "https:" + url;
      if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
      out.push({ title: decode(m[2]), url, snippet: decode(m[3]).slice(0, 400) });
    }
  } catch (e) { console.warn("[search] ddg", e.message); }
  if (out.length) return out;
  return wiki(q, limit);
}
async function wiki(q, limit = 5) {
  const r = await tfetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${limit}&srsearch=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA } });
  const j = await r.json();
  return (j.query?.search || []).map((x) => ({ title: x.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, "_"))}`, snippet: decode(x.snippet) }));
}
async function tavily(q, limit = 6) {
  const r = await tfetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${CFG.search.tavily.apiKey}` }, body: JSON.stringify({ query: q, max_results: limit, search_depth: "basic", include_answer: false }) });
  const j = await r.json(); return (j.results || []).map((x) => ({ title: x.title, url: x.url, snippet: String(x.content || "").slice(0, 500) }));
}
async function brave(q, limit = 6) {
  const r = await tfetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${limit}`, { headers: { Accept: "application/json", "X-Subscription-Token": CFG.search.brave.apiKey } });
  const j = await r.json(); return (j.web?.results || []).map((x) => ({ title: decode(x.title), url: x.url, snippet: decode(x.description).slice(0, 400) }));
}
async function serper(q, limit = 6) {
  const r = await tfetch("https://google.serper.dev/search", { method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": CFG.search.serper.apiKey }, body: JSON.stringify({ q, num: limit }) });
  const j = await r.json(); return (j.organic || []).map((x) => ({ title: x.title, url: x.link, snippet: String(x.snippet || "").slice(0, 400) }));
}

const cache = new Map(); // q -> {at, results}
async function search(q, { limit = 6 } = {}) {
  q = String(q || "").trim().slice(0, 300);
  if (!q) return [];
  const key = `${q}|${limit}`; const c = cache.get(key);
  if (c && Date.now() - c.at < 5 * 60e3) return c.results;
  const order = [CFG.search.tavily && tavily, CFG.search.brave && brave, CFG.search.serper && serper, CFG.search.free && ddg].filter(Boolean);
  let results = [];
  for (const fn of order) { try { results = await fn(q, limit); if (results.length) break; } catch (e) { console.warn("[search]", fn.name, e.message); } }
  cache.set(key, { at: Date.now(), results });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return results;
}

async function readPage(url, max = 3500) {
  try {
    const r = await safeFetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(10000) });
    const ct = r.headers.get("content-type") || "";
    if (!/html|text|json/.test(ct)) return "";
    const html = (await r.text()).slice(0, 600000);
    return decode(html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")).slice(0, max);
  } catch { return ""; }
}

// ---------------------------------------------------------------- Groq browser_search
async function groqResearch(prompt, { model = "openai/gpt-oss-120b", maxTokens = 3000 } = {}) {
  const p = CFG.providers.groq;
  const r = await tfetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], tools: [{ type: "browser_search" }], tool_choice: "required", max_completion_tokens: maxTokens, temperature: 0.3, reasoning_effort: "low" }),
  }, 90000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${j.error?.message || ""}`);
  const msg = j.choices?.[0]?.message || {};
  const text = String(msg.content || "").replace(/【[^】]*】/g, "").trim();
  const urls = new Set();
  for (const m of text.matchAll(/https?:\/\/[^\s)\]>"'`*]+/g)) urls.add(m[0].replace(/[.,;:]+$/, ""));
  for (const t of msg.executed_tools || []) for (const m of String(t.output || "").matchAll(/†([a-z0-9.-]+\.[a-z]{2,})】/gi)) urls.add("https://" + m[1]);
  return { summary: text, sources: [...urls].filter((u) => !/exa\.ai\/search/.test(u)).slice(0, 10).map((url) => ({ url, title: url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] })) };
}

// ---------------------------------------------------------------- research for builds/edits
// returns { summary, sources:[{title,url}], provider } or null
async function research({ topic, queries = [], lang = "en", llm = null, mode = "build", signal = null }) {
  void lang;
  const today = new Date().toISOString().slice(0, 10);
  const qs = [...new Set(queries.map((q) => String(q).trim()).filter(Boolean))].slice(0, 4);
  const ask = mode === "answer"
    ? `Today is ${today}. Search the live web and answer accurately and concisely (max 180 words, plain text with short bullet points if useful). Question: ${String(topic).slice(0, 500)}\nEnd with a line "Sources:" followed by the source URLs (https://...). If you can't verify something, say so.`
    : `Today is ${today}. I am building a website/app and need accurate, CURRENT real-world facts for it.
Project: ${String(topic).slice(0, 1500)}
${qs.length ? `Research these: ${qs.map((q) => `"${q}"`).join("; ")}` : "Research whatever real-world facts this project needs (names, numbers, dates, prices, addresses, schedules, latest news)."}
Also find 1–3 FREE public JSON APIs with CORS and no API key that could power live data for this project, with the exact endpoint URL and a sample field list (e.g. Open-Meteo, CoinGecko, Frankfurter, TheSportsDB, Wikipedia REST, REST Countries, GDELT).
Reply in English as compact bullet points (max 250 words). Every fact must include its source URL in plain form (https://...). If something can't be verified, say so.`;
  if (CFG.providers.groq) {
    for (const model of ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]) {
      try { const r = await groqResearch(ask, { model }); if (r.summary.length > 40) return { ...r, provider: `groq:${model}` }; }
      catch (e) { console.warn("[research] groq", model, e.message); }
    }
  }
  // fallback: search + read + summarise
  const all = [];
  for (const q of (qs.length ? qs : [String(topic).slice(0, 120)])) { try { all.push(...(await search(q, { limit: 5 }))); } catch {} }
  const seen = new Set(); const top = all.filter((r) => !seen.has(r.url) && seen.add(r.url)).slice(0, 8);
  if (!top.length) return null;
  const pages = await Promise.all(top.slice(0, 3).map((r) => readPage(r.url, 2500)));
  const ctx = top.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${r.snippet}${pages[i] ? `\n${pages[i]}` : ""}`).join("\n\n");
  if (llm) {
    try {
      const text = await llm.complete({ kind: "builtin", id: "stak:fast" }, { role: "fast", signal, maxTokens: 1500, temperature: 0.2, system: "You extract accurate facts from web search results. Never invent facts.", messages: [{ role: "user", content: `${ask}\n\nSEARCH RESULTS:\n${ctx.slice(0, 14000)}` }] });
      return { summary: text.trim(), sources: top.map(({ title, url }) => ({ title, url })), provider: "web+summary" };
    } catch (e) { console.warn("[research] summary", e.message); }
  }
  return { summary: top.map((r) => `- ${r.title}: ${r.snippet} (${r.url})`).join("\n"), sources: top.map(({ title, url }) => ({ title, url })), provider: "web" };
}

function providers() {
  return { groq: !!CFG.providers.groq, tavily: !!CFG.search.tavily, brave: !!CFG.search.brave, serper: !!CFG.search.serper, free: !!CFG.search.free };
}

module.exports = { search, research, readPage, needsResearch, providers };

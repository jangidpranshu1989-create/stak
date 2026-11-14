// Tests a user-provided OpenAI-compatible model: connect, small app, browser check, questions JSON, full-stack guestbook
const vm = require("vm");
const { db, J, decrypt } = require("./db");
const llm = require("./llm");
const P = require("./prompts");
const S = require("./site");

const testing = new Set();

function setRow(id, patch) {
  const row = db.prepare("SELECT * FROM models WHERE id=?").get(id);
  if (!row) return null;
  const result = patch.result ? { ...J(row.result, {}), ...patch.result } : J(row.result, {});
  db.prepare("UPDATE models SET status=?, step=?, result=? WHERE id=?").run(patch.status ?? row.status, patch.step ?? row.step, JSON.stringify(result), id);
  return result;
}

function scriptsOk(files) {
  const html = files["index.html"] || "";
  const codes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/src=|type=["']module/.test(m[1])).map((m) => m[2]);
  for (const [p, c] of Object.entries(files)) if (p.endsWith(".js")) codes.push(c);
  for (const c of codes) { if (/^\s*(import|export)\s/m.test(c)) continue; try { new vm.Script(c); } catch { return false; } }
  return true;
}

const SMALL_APP = `Build a tiny but polished single-page "Tip Splitter" app: inputs for bill amount, tip % (buttons 10/15/20 + custom) and number of people; live per-person result; a reset button. Put HTML, CSS and JS all in index.html (inline <style> and <script>).
Output ONLY:
<stak-file path="index.html">
...full file...
</stak-file>`;

const GUESTBOOK = `${P.BUILD_SYSTEM ? "" : ""}Build a minimal full-stack guestbook using the Stak Cloud SDK.
${"Rules: index.html must include <script src=\"stak.js\"></script> then <script src=\"app.js\" defer></script>. app.js must: await stak.ready; use const book = stak.db.collection('entries'); load entries with book.list({sort:'-created', limit:50}); add new entries {name, message} from a form with book.add(...); render them; handle errors with try/catch."}
Output ONLY these two files:
<stak-file path="index.html">
...
</stak-file>
<stak-file path="app.js">
...
</stak-file>`;

async function runProbe(id) {
  if (testing.has(id)) return;
  testing.add(id);
  const row = db.prepare("SELECT * FROM models WHERE id=?").get(id);
  if (!row) { testing.delete(id); return; }
  const m = { baseUrl: row.base_url, apiKey: decrypt(row.api_key), model: row.model };
  const r = { formatOk: false, functional: false, jsonOk: false, fullstack: false, thinking: false, tps: 0, ttftMs: 0, score: 0, categories: [], recommend: "", error: "" };
  db.prepare("UPDATE models SET status='testing', step='connect', result='{}' WHERE id=?").run(id);
  try {
    // 1) connect
    let c;
    try {
      c = await llm.streamOpenAI({ ...m, system: "", messages: [{ role: "user", content: "Reply with exactly: OK" }], maxTokens: 400, temperature: 0, timeoutMs: 60000 });
    } catch (e) {
      r.error = `Could not connect: ${String(e.message).slice(0, 200)}`;
      setRow(id, { status: "failed", step: "connect", result: r });
      return;
    }
    r.ttftMs = c.ttftMs; if (c.thinking) r.thinking = true;
    // 2) small app (stream, report progress)
    setRow(id, { step: "build:0", result: r });
    let lastUp = 0;
    const tick = (kind, n) => { const now = Date.now(); if (now - lastUp > 400) { lastUp = now; setRow(id, { step: `${kind}:${n}` }); } };
    let app;
    try {
      app = await llm.streamOpenAI({
        ...m, system: "You are an expert front-end engineer. Follow the output format exactly.", messages: [{ role: "user", content: SMALL_APP }],
        maxTokens: 8000, temperature: 0.4, timeoutMs: 180000,
        onText: (_t, all) => tick("build", all.length), onThinking: (th) => { r.thinking = true; tick("thinking", th.length); },
      });
    } catch (e) {
      r.error = `Build test failed: ${String(e.message).slice(0, 200)}`;
      setRow(id, { status: "failed", step: "build:0", result: r });
      return;
    }
    r.tps = app.tps; r.ttftMs = app.ttftMs || r.ttftMs; if (app.thinking) r.thinking = true;
    const files = S.parseFiles(app.text);
    r.formatOk = !!files["index.html"] && /<html[\s>]/i.test(files["index.html"]);
    // 3) browser-style functional check
    setRow(id, { step: "browser", result: r });
    const html = files["index.html"] || "";
    r.functional = r.formatOk && /<button\b|<input\b/i.test(html) && /addEventListener|onclick|oninput|onchange/i.test(html) && scriptsOk(files) && /<\/html>/i.test(html);
    // 4) questions JSON
    setRow(id, { step: "json", result: r });
    try {
      const { normalizeQuestions } = require("./jobs");
      const q = await llm.streamOpenAI({ ...m, system: P.QUESTIONS_SYSTEM("en"), messages: [{ role: "user", content: 'The user\'s idea:\n"""A website for my home bakery in Jaipur"""' }], maxTokens: 3000, temperature: 0.5, timeoutMs: 120000 });
      const j = llm.parseJSON(q.text);
      r.jsonOk = !!j && normalizeQuestions(j.questions).length >= 4 && !!j.title;
    } catch { r.jsonOk = false; }
    // 5) full-stack guestbook
    setRow(id, { step: "fullstack", result: r });
    try {
      const g = await llm.streamOpenAI({ ...m, system: "You are an expert full-stack engineer. Follow the output format exactly.\n\n" + "Stak Cloud SDK: window.stak with stak.ready (promise), stak.db.collection(name) -> {list({where,sort,limit}), add(doc), update(id,patch), remove(id)}, stak.auth, stak.ai.ask(prompt).", messages: [{ role: "user", content: GUESTBOOK }], maxTokens: 8000, temperature: 0.3, timeoutMs: 180000 });
      const gf = S.parseFiles(g.text);
      const js = (gf["app.js"] || "") + (gf["index.html"] || "");
      r.fullstack = !!gf["index.html"] && /src=["']\.?\/?stak\.js/.test(gf["index.html"]) && /stak\.db\.collection\(/.test(js) && /\.add\(/.test(js) && /\.list\(/.test(js) && scriptsOk(gf);
    } catch { r.fullstack = false; }
    // score + categories
    const speed = Math.min(20, Math.round((r.tps || 0) / 6));
    r.score = (r.formatOk ? 25 : 0) + (r.functional ? 20 : 0) + (r.jsonOk ? 20 : 0) + (r.fullstack ? 15 : 0) + speed;
    const cats = [];
    if (r.tps >= 120) cats.push("fast");
    if (r.thinking) cats.push("thinking");
    if (r.score >= 75 && r.functional) cats.push("deep");
    if (!cats.length) cats.push(r.tps >= 60 ? "fast" : "deep");
    r.categories = cats;
    const usable = r.formatOk && r.jsonOk;
    if (usable) {
      r.recommend = r.fullstack && r.score >= 80 ? "Full apps with login & database, and big builds"
        : cats.includes("fast") ? "Quick landing pages and small edits"
        : cats.includes("thinking") ? "Complex apps that need careful planning"
        : "Websites and landing pages";
      setRow(id, { status: "ready", step: "done", result: r });
    } else {
      r.recommend = "Chat & questions only — not reliable for building sites (Stak Pro will be used)";
      setRow(id, { status: "chat", step: "done", result: r });
    }
  } catch (e) {
    r.error = String(e.message || e).slice(0, 200);
    setRow(id, { status: "failed", result: r });
  } finally { testing.delete(id); }
}

module.exports = { runProbe };

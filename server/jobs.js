// Stak v3 core engine — background jobs (questions · build · edit), polled via GET /api/jobs/:id?from=N
//
// Build pipeline:  intent → blueprint (spec + acceptance checklist + data rules + design) → live research
//                  → build (kind-specific prompt, streamed) → real photos → QA (static · runtime · intent ·
//                  security · AI acceptance review) → patch-based repair (capped, never charged to the user) → report
// Edit pipeline:   snapshot issues → patch/full edit → QA → repair ONLY regressions the edit introduced → report
const { db, J, rid, decrypt } = require("./db");
const llm = require("./llm");
const P = require("./prompts");
const S = require("./site");
const SEC = require("./security");
const IMG = require("./images");
const WEB = require("./search");
const INTENT = require("./intent");
const CFG = require("./config");
const TPL = require("./templates");
const TW = require("./tw");

const jobs = new Map(); // id -> live job
let running = 0;
const MAX_CONCURRENT = CFG.maxJobs || 4;
const queue = [];

// jobs interrupted by a restart are marked failed so the UI never spins forever
try {
  db.prepare("UPDATE jobs SET status='error', error='Server restarted — please retry', finished=? WHERE status IN ('running','queued')").run(Date.now());
  for (const m of db.prepare("SELECT id, meta FROM messages WHERE meta LIKE '%\"status\":\"running\"%'").all()) {
    const meta = J(m.meta, {}); meta.status = "error"; meta.error = "Server restarted — please retry";
    db.prepare("UPDATE messages SET meta=? WHERE id=?").run(JSON.stringify(meta), m.id);
  }
  db.prepare("UPDATE projects SET stage=CASE WHEN version>0 THEN 'ready' ELSE 'error' END WHERE stage='building'").run();
} catch (e) { console.warn("[jobs] recovery:", e.message); }

function newJob(type, projectId, userId, modelName) {
  const job = {
    id: rid(16), type, projectId, userId, status: "running", phase: "queued", text: "", doneFiles: [], started: Date.now(),
    error: null, model: modelName, plan: "", notes: [], steps: [], usage: { prompt: 0, completion: 0, calls: 0 }, models: new Set(),
    ac: new AbortController(),
  };
  jobs.set(job.id, job);
  db.prepare("INSERT INTO jobs(id,project_id,user_id,type,status,phase,model,started) VALUES(?,?,?,?,?,?,?,?)").run(job.id, projectId, userId, type, "running", "queued", modelName, job.started);
  return job;
}
function persist(job, report) {
  try { db.prepare("UPDATE jobs SET status=?, phase=?, model=?, error=?, report=?, finished=? WHERE id=?").run(job.status, job.phase, job.model, job.error, JSON.stringify(report || {}), job.finished || null, job.id); } catch {}
}
function activeJobFor(projectId) {
  for (const j of jobs.values()) if (j.projectId === projectId && j.status === "running") return j;
  return null;
}
// step timeline shown in the UI: [{id,label,status:'run'|'done'|'skip'|'error',ms,detail}]
function step(job, id, label, status = "run", detail) {
  let s = job.steps.find((x) => x.id === id);
  if (!s) { s = { id, label, status, t0: Date.now() }; job.steps.push(s); }
  s.status = status; if (label) s.label = label; if (detail !== undefined) s.detail = detail;
  if (status !== "run") s.ms = Date.now() - s.t0;
  if (status === "run") job.phase = id;
}
function jobView(job, from = 0) {
  if (!job) return { status: "gone" };
  return {
    status: job.status, phase: job.phase, delta: job.text.slice(from), doneFiles: job.doneFiles, type: job.type,
    elapsed: Math.round((Date.now() - job.started) / 1000), error: job.error, model: job.model,
    plan: job.plan || undefined, blueprint: job.blueprint || undefined, kind: job.kind, sources: job.sources?.length ? job.sources : undefined,
    notes: job.notes.length ? job.notes : undefined, steps: job.steps.map(({ t0, ...s }) => s), usage: job.usage,
  };
}
setInterval(() => { const now = Date.now(); for (const [id, j] of jobs) if (j.status !== "running" && now - (j.finished || now) > 15 * 60e3) jobs.delete(id); }, 60e3).unref();

function schedule(job, fn) {
  return new Promise((resolve) => {
    const go = async () => { running++; try { if (job.status === "running") await fn(); } finally { running--; resolve(); const n = queue.shift(); if (n) n(); } };
    if (running < MAX_CONCURRENT) go(); else { job.phase = "queued"; queue.push(go); }
  });
}
function stopJob(projectId) {
  const j = activeJobFor(projectId);
  if (!j) return false;
  j.status = "stopped"; j.error = "Stopped by you"; j.finished = Date.now();
  try { j.ac.abort(); } catch {}
  persist(j);
  return j;
}
const stopped = (job) => job.status === "stopped" || job.ac.signal.aborted;
const STOP = () => Object.assign(new Error("Stopped"), { aborted: true });

// ---- message helpers ----
function addMessage(projectId, role, kind, content, meta = {}) {
  const r = db.prepare("INSERT INTO messages(project_id,role,kind,content,meta,created) VALUES(?,?,?,?,?,?)").run(projectId, role, kind, content, JSON.stringify(meta), Date.now());
  return Number(r.lastInsertRowid);
}
function getMessage(id) { const m = db.prepare("SELECT * FROM messages WHERE id=?").get(id); if (m) m.meta = J(m.meta, {}); return m; }
function updateMessage(id, patch) {
  const m = getMessage(id); if (!m) return;
  const meta = patch.meta ? { ...m.meta, ...patch.meta } : m.meta;
  db.prepare("UPDATE messages SET content=?, kind=?, meta=? WHERE id=?").run(patch.content ?? m.content, patch.kind ?? m.kind, JSON.stringify(meta), id);
}
function touch(projectId, fields = {}) {
  const sets = Object.keys(fields).map((k) => `${k}=?`);
  db.prepare(`UPDATE projects SET ${[...sets, "updated=?"].join(",")} WHERE id=?`).run(...Object.values(fields), Date.now(), projectId);
}
const getProject = (id) => db.prepare("SELECT * FROM projects WHERE id=?").get(id);

// ---- model resolution ----
const PRO = { kind: "builtin", id: "stak:pro", name: "Stak Pro" };
function resolveModel(userId, wanted) {
  const id = String(wanted || "");
  const b = llm.builtin(id);
  if (b) return { kind: "builtin", id: b.id, name: b.name };
  if (id) {
    const row = db.prepare("SELECT * FROM models WHERE id=? AND user_id=?").get(id, userId);
    if (row && row.status === "ready") return { kind: "user", id: row.id, name: row.name, baseUrl: row.base_url, apiKey: decrypt(row.api_key), model: row.model };
  }
  return PRO;
}
// one LLM call with job bookkeeping (abort, usage, model tracking, rate-limit notes)
async function call(job, m, opts) {
  if (stopped(job)) throw STOP();
  const r = await llm.stream(m, {
    ...opts, signal: job.ac.signal,
    onWait: (c, s) => job.notes.push(`${c.name}: rate limit, waited ${s}s`),
  });
  job.usage.calls++; job.usage.prompt += r.usage?.prompt || 0; job.usage.completion += r.usage?.completion || 0;
  if (r.modelName) job.models.add(r.modelName);
  return r;
}
// user's own model first, then Stak Pro (never fail just because a BYO key is down)
async function withFallback(job, model, fn) {
  try { return await fn(model); }
  catch (e) {
    if (e.aborted || model.kind !== "user") throw e;
    job.notes.push(`${model.name} failed — continued with Stak Pro`);
    return fn(PRO);
  }
}

// ---- notifications + event log ----
let pushSend = null;
function setPush(fn) { pushSend = fn; }
function notify(userId, payload) { try { pushSend && pushSend(userId, payload); } catch {} }
function event(userId, type, projectId, title, body) {
  try { db.prepare("INSERT INTO events(user_id,type,project_id,title,body,created) VALUES(?,?,?,?,?,?)").run(userId, type, projectId, String(title || "").slice(0, 120), String(body || "").slice(0, 300), Date.now()); } catch {}
}

function friendly(e) {
  const m = String(e?.message || e || "Something went wrong");
  if (/rate|429|too many/i.test(m)) return "All AI models are busy right now (rate limit). Please retry in a minute.";
  if (/timed? ?out/i.test(m)) return "The AI took too long — please retry.";
  if (/not configured/i.test(m)) return m;
  return m.slice(0, 300);
}

// ---- research ----
function latestQuestionsMeta(projectId) {
  const m = db.prepare("SELECT meta FROM messages WHERE project_id=? AND kind='questions' ORDER BY id DESC LIMIT 1").get(projectId);
  return J(m?.meta, {});
}
async function webContext(job, topic, queries) {
  if (!queries.length && !WEB.needsResearch(topic)) return "";
  step(job, "research", "Researching the live web");
  try {
    const r = await Promise.race([WEB.research({ topic, queries, llm }), new Promise((res) => setTimeout(() => res(null), 60000))]);
    if (!r || !r.summary) { step(job, "research", null, "skip", "nothing useful found"); return ""; }
    job.sources = r.sources || [];
    step(job, "research", null, "done", `${job.sources.length} sources`);
    return `\nLIVE WEB RESEARCH (fetched ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC):\n${r.summary.slice(0, 5000)}\n${job.sources.length ? `SOURCES:\n${job.sources.slice(0, 8).map((x) => `- ${x.url}`).join("\n")}\n` : ""}`;
  } catch (e) { step(job, "research", null, "skip", e.message.slice(0, 80)); return ""; }
}

// ============ QUESTIONS ============
function normalizeQuestions(raw) {
  const out = [];
  let secrets = 0;
  for (const q of Array.isArray(raw) ? raw : []) {
    if (!q || !q.question) continue;
    let type = String(q.type || "single").toLowerCase();
    if (/choice|select|radio/.test(type)) type = "single";
    if (/checkbox|multiple/.test(type)) type = "multi";
    if (/image|upload|photo/.test(type)) type = "images";
    if (!["single", "multi", "text", "secret", "images"].includes(type)) type = "single";
    const item = { type, question: String(q.question).slice(0, 240) };
    if (type === "images") {
      item.slot = String(q.slot || "photos").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 24) || "photos";
      item.max = Math.max(1, Math.min(20, Number(q.max) || 12));
      item.options = (q.options || []).slice(0, 2).map(String);
      if (q.aiNote) item.aiNote = String(q.aiNote).slice(0, 200);
    } else if (type === "secret") {
      if (secrets++ || !q.secretName) continue;
      item.secretName = String(q.secretName).toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 40);
      if (q.placeholder) item.placeholder = String(q.placeholder).slice(0, 40);
      if (/^https:\/\//.test(q.helpUrl || "")) item.helpUrl = q.helpUrl;
      item.optional = true;
    } else if (type === "text") item.placeholder = String(q.placeholder || "").slice(0, 120);
    else {
      const opts = (Array.isArray(q.options) ? q.options : []).map((o) => String(typeof o === "object" ? o.label || o.value || "" : o).slice(0, 80)).filter(Boolean).slice(0, 6);
      if (opts.length < 2) { item.type = "text"; item.placeholder = String(q.placeholder || "").slice(0, 120); } else item.options = opts;
    }
    out.push(item);
  }
  const normal = out.filter((q) => q.type !== "secret" && q.type !== "images").slice(0, 5);
  const images = out.filter((q) => q.type === "images").slice(0, 1);
  return [...normal.slice(0, 3), ...images, ...normal.slice(3), ...out.filter((q) => q.type === "secret")].map((q, i) => ({ ...q, id: `q${i + 1}` }));
}

// photo-centric ideas get an (honest) upload question. Word boundaries prevent "room" in "classroom" etc. from matching.
const PHOTO_IDEA = /\b(portfolio|photograph(y|er)?|photos?|gallery|wedding|restaurant|cafe|café|bakery|menu|dishes|food|products?|shop|store|boutique|fashion|jewell?ery|salon|spa|hotel|resort|homestay|real ?estate|property|interior|architect(ure)?|travel|tours?|venue|gym|clinic|artist|tattoo|furniture|showroom)\b|फोटो|दुकान|रेस्टोरेंट/i;
const IMG_Q = {
  en: ["Want to add your own photos?", "Yes — I'll upload my own photos", "No — use real stock photos for now", "No problem — Stak will pick real, free-licensed photos that match your project. You can swap them any time."],
  hinglish: ["Apni photos daalna chahenge?", "Haan — main apni photos upload karunga", "Nahi — abhi real stock photos laga do", "Koi baat nahi — Stak aapke project se match karti real, free-license photos laga dega. Baad mein kabhi bhi badal sakte ho."],
  hi: ["क्या आप अपनी फ़ोटो जोड़ना चाहेंगे?", "हाँ — मैं अपनी फ़ोटो अपलोड करूँगा", "नहीं — अभी असली स्टॉक फ़ोटो लगा दें", "कोई बात नहीं — Stak आपके प्रोजेक्ट से मेल खाती असली, फ्री-लाइसेंस फ़ोटो लगा देगा।"],
};
function ensureImagesQuestion(questions, prompt, lang, kind) {
  if (kind !== "site" || questions.some((q) => q.type === "images") || !PHOTO_IDEA.test(prompt)) return questions;
  const t = IMG_Q[lang] || IMG_Q.en;
  const q = { type: "images", slot: /portfolio|photo|wedding|gallery|फोटो/i.test(prompt) ? "portfolio" : "photos", max: 12, question: t[0], options: [t[1], t[2]], aiNote: t[3] };
  const normal = questions.filter((x) => x.type !== "secret");
  return [...normal.slice(0, 3), q, ...normal.slice(3), ...questions.filter((x) => x.type === "secret")].map((x, i) => ({ ...x, id: `q${i + 1}` }));
}

function startQuestions({ project, userId, lang, wanted, msgId }) {
  const model = resolveModel(userId, wanted);
  const job = newJob("questions", project.id, userId, model.name);
  const guess = INTENT.classify(project.prompt);
  job.kind = guess.kind;
  schedule(job, async () => {
    try {
      step(job, "questions", "Understanding your idea");
      const r = await withFallback(job, model, async (m) => {
        const res = await call(job, m, {
          role: "fast", system: P.QUESTIONS_SYSTEM(lang, guess.kind), maxTokens: 1800, temperature: 0.6,
          messages: [{ role: "user", content: `The user's idea:\n"""${project.prompt}"""` }], onText: null,
        });
        const j = llm.parseJSON(res.text);
        if (!j || normalizeQuestions(j.questions).filter((q) => q.type !== "secret").length < 3) throw Object.assign(new Error("Model returned invalid questions JSON"), { status: 502 });
        return j;
      });
      const intent = INTENT.decide(project.prompt, r.kind);
      job.kind = intent.kind;
      const questions = ensureImagesQuestion(normalizeQuestions(r.questions), project.prompt, lang, intent.kind);
      const title = String(r.title || "").trim().slice(0, 60) || project.title;
      const intro = String(r.intro || "").trim() || "Love it! A few quick questions so I can nail this.";
      const research = Array.isArray(r.research) ? r.research.map((x) => String(x).slice(0, 200)).filter(Boolean).slice(0, 3) : [];
      updateMessage(msgId, { content: intro, meta: { status: "ready", questions, research, kind: intent.kind, intent } });
      touch(project.id, { title, stage: "questions", kind: intent.kind });
      step(job, "questions", null, "done");
      job.status = "done";
      event(userId, "questions_ready", project.id, title, intro.slice(0, 200));
      notify(userId, { title: `${title}: a few quick questions`, body: "Answer them to start the build", tag: project.id, url: `./#/p/${project.id}` });
    } catch (e) {
      if (e.aborted || stopped(job)) { job.status = "stopped"; updateMessage(msgId, { meta: { status: "error", error: "Stopped by you" } }); return; }
      console.error("[questions]", e.message);
      job.status = "error"; job.error = friendly(e);
      updateMessage(msgId, { content: "", meta: { status: "error", error: job.error } });
      event(userId, "job_failed", project.id, project.title, job.error);
    } finally { job.finished = job.finished || Date.now(); job.phase = "done"; persist(job); }
  });
  return job;
}

// ============ STREAM TRACKING ============
function trackFiles(job, text) {
  const re = /<stak-(file|edit) path="([^"]+)">/g;
  let m, last = null;
  const done = new Set(job.doneFiles);
  while ((m = re.exec(text))) { if (text.indexOf(`</stak-${m[1]}>`, m.index) >= 0) done.add(m[2]); else last = m[2]; }
  job.doneFiles = [...done];
  job.writing = last || null;
}

function briefFrom(project, { answers, notes, skip, questions }) {
  let s = `PROJECT IDEA:\n${project.prompt}\n`;
  if (skip) s += `\nThe user skipped the questions — choose excellent, specific defaults yourself.\n`;
  else if (questions?.length) {
    s += `\nTHE USER'S ANSWERS:\n`;
    for (const q of questions) {
      if (q.type === "secret" || q.type === "images") continue;
      const a = answers?.[q.id];
      s += `- ${q.question}\n  → ${a && a.length ? a.join(", ") : "(no preference — you decide)"}\n`;
    }
  }
  for (const q of (questions || []).filter((x) => x.type === "images")) {
    const ups = (answers?.[q.id] || []).filter((v) => String(v).startsWith("upload:assets/")).map((v) => String(v).slice(7));
    if (ups.length) s += `\nUSER-UPLOADED PHOTOS for the "${q.slot}" section — use ALL of these exact paths, in this order:\n${ups.map((u) => "- " + u).join("\n")}\n`;
  }
  const secrets = (questions || []).filter((q) => q.type === "secret").map((q) => q.secretName);
  if (secrets.length) s += `\nSAVED SECRETS available via stak.fetch placeholders: ${secrets.map((n) => `{{${n}}}`).join(", ")}\n`;
  if (notes) s += `\nEXTRA NOTES FROM THE USER:\n${notes}\n`;
  return s;
}

// ============ QA ============
// returns { files, fixed, issues:[{file,problem,kind,severity}], security, review, rules }
async function inspect(files, title, { kind, prompt, rules, tw = true }) {
  if (tw) files = await TW.apply(S.withKit(files), { force: true });
  const v = await S.verifyFull(files, title, { kind, prompt });
  if (tw) {
    const miss = TW.undefinedClasses(v.files);
    if (miss.length >= 3) v.remaining.push({ file: "index.html", kind: "design", problem: `${miss.length} CSS classes are used in the markup but defined nowhere, so those elements render unstyled: ${miss.slice(0, 18).join(", ")}`, fix: "replace them with Tailwind utilities or Stak kit classes (e.g. .btn is already the primary button), or define them in styles.css" });
  }
  const sec = SEC.scan(v.files, { rules: v.rules || rules });
  const issues = [
    ...v.remaining.map((r) => ({ ...r, kind: r.kind || "code", severity: r.kind === "intent" ? "high" : "medium" })),
    ...sec,
  ];
  return { files: v.files, fixed: v.fixed, issues, rules: v.rules, security: { ...SEC.grade(sec), issues: sec } };
}
// fatal issues (app can't run) outweigh any number of cosmetic ones
const weight = (list) => list.reduce((n, i) => n + (/syntax error|runtime error|nothing calls them|empty screen|wrong kind/i.test(i.problem) ? 25 : i.severity === "high" ? 6 : i.kind === "design" ? 2 : 3), 0);
const issueKey = (i) => `${i.file}|${i.kind}|${String(i.problem).replace(/\d+/g, "#").slice(0, 90)}`;

async function review(job, files, blueprint, used, { only, id = "review", label = "AI acceptance review" } = {}) {
  const list = only || blueprint?.acceptance || [];
  if (!list.length) return null;
  step(job, id, label);
  try {
    // logic first (app.js decides most checks), markup trimmed of inline SVG/CSS noise; never silently drop app.js
    const slim = (p, c) => (/\.html?$/.test(p) ? String(c).replace(/<svg[\s\S]*?<\/svg>/gi, "<svg/>").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/\n\s*\n+/g, "\n") : String(c).replace(/^\s*\/\/.*$/gm, "").replace(/\n\s*\n+/g, "\n"));
    const picked = Object.entries(files).filter(([p]) => /\.(html|js|json)$/.test(p) && !p.startsWith("stak")).sort(([a], [b]) => (/\.js$/.test(b) ? 1 : 0) - (/\.js$/.test(a) ? 1 : 0)).map(([p, c]) => [p, slim(p, c)]);
    const code = P.filesBlock(Object.fromEntries(picked), 48000);
    if (/\(omitted: too large\)/.test(code)) { step(job, id, null, "skip", "project too large for the reviewer"); return null; }
    const r = await call(job, used.kind === "user" ? PRO : used, {
      role: "fast", system: P.REVIEW_SYSTEM, maxTokens: 1500, temperature: 0, maxAttempts: 3, continuable: false,
      messages: [{ role: "user", content: `ACCEPTANCE CHECKLIST:\n${list.slice(0, 10).map((a) => "- " + a).join("\n")}\n\nCODE:\n${code}` }], onText: null,
    });
    const j = llm.parseJSON(r.text);
    const checks = (j?.checks || []).slice(0, 12).map((c) => ({ check: String(c.check || "").slice(0, 200), pass: !!c.pass, why: String(c.why || "").slice(0, 200) }));
    const passed = checks.filter((c) => c.pass).length;
    step(job, id, null, "done", `${passed}/${checks.length} checks passed`);
    return { checks, passed, total: checks.length, score: checks.length ? Math.round((passed / checks.length) * 100) : null };
  } catch (e) {
    if (e.aborted) throw e;
    step(job, id, null, "skip", "reviewer unavailable");
    return null;
  }
}

function applyOutput(files, out) {
  const next = { ...files, ...S.parseFiles(out) };
  const failed = [];
  for (const p of S.parsePatches(out)) {
    if (next[p.path] === undefined) { failed.push(p); continue; }
    let src = next[p.path], bad = 0;
    for (const b of p.blocks) { const r = S.applyBlock(src, b); if (r.ok) src = r.src; else bad++; }
    next[p.path] = src;
    if (bad) failed.push({ ...p, bad });
  }
  return { files: next, failed };
}

// QA + capped repair loop. `baseline` (edit mode) = issue keys that existed before the edit; only new ones are repaired.
async function qa(job, files, ctx) {
  const { title, kind, prompt, blueprint, used, baseline } = ctx;
  const tw = !job.template;
  step(job, "qa", "Testing the code");
  let cur = await inspect(files, title, { kind, prompt, tw });
  let fixedAuto = cur.fixed;
  const reviewed = blueprint && !baseline ? await review(job, cur.files, blueprint, used) : null;
  const target = (list) => list.filter((i) => !baseline || !baseline.has(issueKey(i))).filter((i) => i.severity !== "low");
  let todo = target(cur.issues);
  if (reviewed) todo.push(...reviewed.checks.filter((c) => !c.pass).slice(0, 4).map((c) => ({ file: "app.js", problem: `Acceptance check failed: ${c.check} (${c.why})`, kind: "acceptance", severity: "medium" })));
  step(job, "qa", null, "done", `${cur.issues.length} issue${cur.issues.length === 1 ? "" : "s"} found`);
  let rounds = 0, repaired = 0, accTried = todo.some((i) => i.kind === "acceptance"), accFixed = 0;
  const startCount = todo.length;
  while (todo.length && rounds < CFG.repairRounds && !stopped(job)) {
    rounds++;
    step(job, `repair${rounds}`, rounds === 1 ? "Fixing problems" : "Second repair pass");
    const involved = [...new Set(todo.map((i) => (cur.files[i.file] ? i.file : "index.html")))];
    const ctxFiles = Object.fromEntries(involved.concat(involved.includes("app.js") || !cur.files["app.js"] ? [] : ["app.js"]).slice(0, 4).map((f) => [f, cur.files[f]]).filter(([, c]) => c != null));
    const intentRewrite = todo.some((i) => i.kind === "intent" && /landing page/.test(i.problem));
    try {
      const r = await call(job, used.kind === "user" ? PRO : used, {
        role: "build", system: intentRewrite ? P.BUILD_SYSTEM(ctx.lang, kind) : P.REPAIR_SYSTEM, maxTokens: 16000, temperature: 0.2, maxAttempts: 3,
        messages: [{ role: "user", content: `${intentRewrite ? `${prompt ? `ORIGINAL REQUEST: ${prompt}\n` : ""}The previous build was the wrong kind of product. Rebuild index.html, styles.css and app.js so the first screen IS the working ${kind}.\n` : ""}PROJECT FILES: ${Object.keys(cur.files).join(", ")}\nPROBLEMS TO FIX:\n${todo.slice(0, 12).map((i) => `- [${i.file}] ${i.problem}${i.fix ? ` → ${i.fix}` : ""}`).join("\n")}\n\n${P.filesBlock(ctxFiles, 60000)}` }],
        onText: null,
      });
      const applied = applyOutput(cur.files, r.text);
      if (applied.failed.length) job.notes.push(`Repair: ${applied.failed.length} patch(es) didn't apply cleanly`);
      const next = await inspect(applied.files, title, { kind, prompt, tw });
      const before = new Set(cur.issues.map(issueKey)), after = new Set(next.issues.map(issueKey));
      const gone = [...before].filter((k) => !after.has(k)).length, added = [...after].filter((k) => !before.has(k)).length;
      if (weight(next.issues) < weight(cur.issues) || (weight(next.issues) === weight(cur.issues) && gone > added)) { // keep only real improvements — a "fix" that breaks the app never ships
        repaired += Math.max(0, gone - added);
        fixedAuto += next.fixed;
        cur = next;
      } else job.notes.push("A repair attempt made things worse and was discarded");
      step(job, `repair${rounds}`, null, "done", gone ? `${gone} code issue${gone === 1 ? "" : "s"} fixed` : "patch applied");
    } catch (e) {
      if (e.aborted) throw e;
      step(job, `repair${rounds}`, null, "error", friendly(e).slice(0, 80));
      break;
    }
    todo = target(cur.issues).filter((i) => i.kind !== "acceptance");
  }
  // re-check only the acceptance items that failed, so the report reflects the shipped code honestly
  if (reviewed && accTried && rounds && !stopped(job)) {
    const failed = reviewed.checks.filter((c) => !c.pass);
    const again = await review(job, cur.files, blueprint, used, { only: failed.map((c) => c.check), id: "recheck", label: "Re-checking fixed items" });
    if (again) {
      for (const c of again.checks) {
        const orig = reviewed.checks.find((o) => !o.pass && (o.check === c.check || o.check.slice(0, 40) === c.check.slice(0, 40)));
        if (orig && c.pass) { orig.pass = true; orig.why = c.why; accFixed++; }
      }
      reviewed.passed = reviewed.checks.filter((c) => c.pass).length;
      reviewed.score = reviewed.checks.length ? Math.round((reviewed.passed / reviewed.checks.length) * 100) : null;
      repaired += accFixed;
    }
  }
  return { files: cur.files, rules: cur.rules, autoFixed: fixedAuto, repaired, rounds, found: startCount, issues: cur.issues, security: cur.security, review: reviewed };
}

function saveVersion(projectId, files, label, rules) {
  files = S.withKit(files);
  const n = (db.prepare("SELECT MAX(n) m FROM versions WHERE project_id=?").get(projectId).m || 0) + 1;
  db.prepare("INSERT INTO versions(project_id,n,label,files,created) VALUES(?,?,?,?,?)").run(projectId, n, String(label).slice(0, 80), JSON.stringify(files), Date.now());
  touch(projectId, { files: JSON.stringify(files), version: n, ...(rules ? { rules: JSON.stringify(rules) } : {}) });
  applySeed(projectId, files);
  return n;
}

// insert stak.seed.json items once into collections that are still empty (owner = null → only admins can change them)
function applySeed(projectId, files) {
  const seed = S.readSeed(files);
  if (!seed) return 0;
  let added = 0;
  const ins = db.prepare("INSERT INTO rt_docs(id,project_id,col,owner,data,created,updated) VALUES(?,?,?,NULL,?,?,?)");
  db.transaction(() => {
    for (const [col, docs] of Object.entries(seed)) {
      if (db.prepare("SELECT 1 FROM rt_docs WHERE project_id=? AND col=? LIMIT 1").get(projectId, col)) continue;
      const t = Date.now();
      docs.forEach((d, i) => { const s = JSON.stringify(d); if (s.length < 50000) { ins.run(rid(14), projectId, col, s, t - i, t - i); added++; } });
    }
  })();
  return added;
}

function reportOf(job, final, extra = {}) {
  return {
    kind: job.kind, duration: Date.now() - job.started, models: [...job.models], usage: job.usage, steps: job.steps.map(({ t0, ...s }) => s),
    qa: { found: final.found, repaired: final.repaired, autoFixed: final.autoFixed, rounds: final.rounds, remaining: final.issues.filter((i) => i.kind !== "security").map((i) => `${i.file}: ${i.problem}`).slice(0, 12) },
    security: { score: final.security.score, label: final.security.label, issues: final.security.issues.map(({ file, severity, problem, fix }) => ({ file, severity, problem, fix })).slice(0, 10) },
    review: final.review || undefined, sources: job.sources?.length ? job.sources.slice(0, 8) : undefined, notes: job.notes.length ? job.notes : undefined, ...extra,
  };
}

// ============ BUILD ============
// ============ TEMPLATE-FIRST BUILD ============
// Curated, hand-built app (chat / tracker / site) + a small model-written JSON config. Returns null to fall back.
async function templateBuild(job, project, { arch, brief, lang, model, web }) {
  step(job, "blueprint", `Designing your ${TPL.LABEL[arch]}`);
  const today = new Date().toISOString().slice(0, 10);
  const system = TPL.PROMPTS[arch](P.langName(lang), today);
  let cfg = null;
  try {
    const r = await call(job, model.kind === "user" ? model : model, {
      role: "plan", system, maxTokens: arch === "site" ? 5000 : 3800, temperature: 0.6, maxAttempts: 4, continuable: false, reasoning: "low",
      messages: [{ role: "user", content: `${brief}${web || ""}\n\nHARD FACTS - copy exactly, never replace with other cities/names/numbers: the user said: "${String(project.prompt).slice(0, 600)}". Web research above is ONLY for ideas and wording - it may describe a different business with the same name. Never copy addresses, landmarks, pincodes or phone numbers from it; if the user gave no address, write a simple one in THEIR city (e.g. "Near City Mall, <their city>").\n\nWrite the JSON config now.` }], onText: null,
      validate: (t) => { const j = llm.parseJSON(t); return j && typeof j === "object" && (j.name || j.fields || j.hero) ? null : "Config was not valid JSON"; },
    });
    cfg = llm.parseJSON(r.text);
    if (r.modelName) job.model = r.modelName;
  } catch (e) {
    if (e.aborted) throw e;
    console.warn("[template]", arch, e.message);
    if (model.kind === "user") { try { return await templateBuild(job, project, { arch, brief, lang, model: PRO, web }); } catch (e2) { if (e2.aborted) throw e2; } }
    step(job, "blueprint", null, "skip", "falling back to a custom build");
    return null;
  }
  const out = TPL.render(arch, cfg, { title: project.title, prompt: project.prompt, lang });
  if (!out) return null;
  const c = out.cfg;
  job.blueprint = { name: c.name, oneLiner: c.tagline || c.description || "", features: [], acceptance: [], template: arch };
  step(job, "blueprint", null, "done", arch === "tracker" ? `${c.fields.length} fields · ${c.seed.length} sample entries` : arch === "chat" ? `${c.suggestions.length} starter prompts` : `${(c.sections || []).length} sections`);
  step(job, "build", "Assembling the app");
  for (const p of Object.keys(out.files)) job.doneFiles.push(p);
  step(job, "build", null, "done", `${Object.keys(out.files).length} files · production template`);
  return { files: out.files, summary: TPL.SUMMARY[arch](c) };
}

function startBuild({ project, userId, lang, wanted, msgId, brief, label = "Build" }) {
  const model = resolveModel(userId, wanted);
  const job = newJob("build", project.id, userId, model.name);
  const qmeta = latestQuestionsMeta(project.id);
  job.kind = INTENT.normKind(qmeta.kind) || INTENT.normKind(project.kind) || INTENT.classify(project.prompt).kind;
  touch(project.id, { stage: "building", kind: job.kind });
  updateMessage(msgId, { meta: { status: "running", started: job.started, phase: "queued", model: model.name, job: job.id } });
  schedule(job, async () => {
    let used = model;
    try {
      const arch = TPL.pick(project.prompt, job.kind);
      let res = null, blueprint = null;
      if (arch) {
        const web = job.webCtx = await webContext(job, brief, Array.isArray(qmeta.research) ? qmeta.research : []);
        res = await templateBuild(job, project, { arch, brief, lang, model, web });
        if (res) { job.template = arch; if (job.model) used = { ...model, name: job.model }; }
      }
      if (!res) {
      // 1) blueprint
      step(job, "blueprint", "Designing the blueprint");
      try {
        const r = await call(job, model, {
          role: "plan", system: P.BLUEPRINT_SYSTEM(lang, job.kind), maxTokens: 2600, temperature: 0.4, maxAttempts: 3, continuable: false,
          reasoning: "low", messages: [{ role: "user", content: brief }], onText: null,
        });
        blueprint = llm.parseJSON(r.text);
      } catch (e) { if (e.aborted) throw e; console.warn("[blueprint]", e.message); }
      if (blueprint && typeof blueprint === "object") {
        job.blueprint = { name: blueprint.name, oneLiner: blueprint.oneLiner, features: (blueprint.features || []).slice(0, 10), acceptance: (blueprint.acceptance || []).slice(0, 10), data: (blueprint.data || []).slice(0, 6), design: blueprint.design, screens: (blueprint.screens || []).slice(0, 4) };
        job.plan = blueprint.oneLiner || "";
        step(job, "blueprint", null, "done", `${job.blueprint.features.length} features · ${job.blueprint.acceptance.length} checks`);
        touch(project.id, { blueprint: JSON.stringify(job.blueprint) });
      } else step(job, "blueprint", null, "skip", "building from the brief");

      // 2) research
      const web = job.webCtx ?? await webContext(job, brief, Array.isArray(qmeta.research) ? qmeta.research : []);

      // 3) build
      step(job, "build", "Writing the code");
      // keep the whole request inside an 8k tokens-per-minute bucket (Groq free tier): research is the most expendable part
      const sys0 = P.BUILD_SYSTEM(lang, job.kind), tail = P.blueprintBlock(blueprint) + `\n${P.BUILD_LINE(job.kind, lang)}`;
      const LL = require("./llm");
      let webFit = web;
      for (const cap of [2200, 900, 0]) { if (LL.estTokens([{ content: brief + webFit + tail }], sys0) <= 7300) break; webFit = cap ? web.slice(0, cap) + "\n" : ""; }
      const userMsg = brief + webFit + tail;
      console.log(`[build] prompt ≈ ${LL.estTokens([{ content: userMsg }], sys0)} tokens (research ${webFit.length}/${web.length} chars)`);
      res = await withFallback(job, model, async (m) => {
        let startLen = job.text.length, last = 0;
        const r = await call(job, m, {
          role: "build", system: P.BUILD_SYSTEM(lang, job.kind), maxTokens: 16000, temperature: 0.55,
          messages: [{ role: "user", content: userMsg }],
          validate: (t, r) => (S.parseFiles(t)["index.html"] ? null : r.stop === "max_tokens" ? "Output was cut off before index.html was complete" : "Model did not return a valid index.html"),
          onRestart: (c) => { job.text += "\n"; startLen = job.text.length; job.doneFiles = []; job.notes.push(`Switched to ${c.name} mid-build`); },
          onFallback: (c) => { job.model = `${c.name} · ${c.by}`; },
          onText: (t) => { job.text += t; const now = Date.now(); if (now - last > 200) { last = now; trackFiles(job, job.text.slice(startLen)); } },
        });
        const out = job.text.slice(startLen);
        trackFiles(job, out);
        const files = S.parseFiles(out);
        if (!files["index.html"]) throw Object.assign(new Error(r.stop === "max_tokens" ? "The output was cut off before index.html was complete" : "Model did not return a valid index.html"), { status: 502 });
        if (r.modelName) { job.model = r.modelName; used = { ...m, name: r.modelName }; }
        return { files, summary: S.summaryOf(out) };
      });
      step(job, "build", null, "done", `${Object.keys(res.files).length} files`);
      }
      if (stopped(job)) throw STOP();

      // 4) photos
      let files = res.files, credits = [];
      if (CFG.images.commons && IMG.photoRefs(files).length) {
        step(job, "photos", "Adding real photos");
        const p = await IMG.resolvePhotos(project.id, files, { signal: job.ac.signal, onProgress: (d, t) => step(job, "photos", null, "run", `${d}/${t}`) });
        files = p.files; credits = p.credits;
        step(job, "photos", null, "done", `${p.resolved} photos`);
      }

      // 5) QA + repair
      const final = await qa(job, files, { title: project.title, kind: job.kind, prompt: project.prompt, blueprint: job.blueprint, used, lang });
      if (stopped(job)) throw STOP();
      step(job, "publish", "Publishing");
      const version = saveVersion(project.id, final.files, label, final.rules);
      const report = reportOf(job, final, { version, photos: credits.length ? credits : undefined });
      step(job, "publish", null, "done", `v${version}`);
      report.steps = job.steps.map(({ t0, ...s }) => s);
      updateMessage(msgId, {
        content: res.summary || "Your project is ready — have a look at the preview.",
        meta: { status: "done", files: Object.keys(final.files), duration: report.duration, version, model: used.name, notes: job.notes, report, blueprint: job.blueprint, job: job.id },
      });
      touch(project.id, { stage: "ready" });
      job.status = "done"; job.phase = "done";
      persist(job, report);
      event(userId, "build_done", project.id, getProject(project.id).title, `v${version} is live`);
      notify(userId, { title: `${getProject(project.id).title} is ready`, body: "Your build finished on Stak", tag: project.id, url: `./#/p/${project.id}` });
    } catch (e) { fail(job, msgId, project, e, userId); }
    finally { job.finished = job.finished || Date.now(); if (job.status !== "done") persist(job); }
  });
  return job;
}

function fail(job, msgId, project, e, userId) {
  if (e.aborted || stopped(job)) {
    job.status = "stopped"; job.error = "Stopped by you";
    updateMessage(msgId, { meta: { status: "stopped", error: "Stopped by you", report: { steps: job.steps.map(({ t0, ...s }) => s), usage: job.usage } } });
  } else {
    console.error(`[${job.type}]`, e.message);
    job.status = "error"; job.error = friendly(e);
    updateMessage(msgId, { meta: { status: "error", error: job.error } });
    event(userId, "job_failed", project.id, project.title, job.error);
  }
  const s = job.steps.find((x) => x.status === "run"); if (s) { s.status = job.status === "stopped" ? "skip" : "error"; s.ms = Date.now() - s.t0; }
  touch(project.id, { stage: getProject(project.id)?.version > 0 ? "ready" : "error" });
}

// ============ EDIT ============
function startEdit({ project, userId, lang, wanted, msgId, text, selection, history }) {
  const model = resolveModel(userId, wanted);
  const job = newJob("edit", project.id, userId, model.name);
  job.kind = INTENT.normKind(project.kind) || "app";
  // an edit can change what the product is ("make this a real chatbot app")
  const shift = INTENT.classify(text);
  if (shift.confidence >= 0.9 && shift.kind !== job.kind && /\b(make|turn|convert|change|bana|badal)\b/i.test(text)) { job.kind = shift.kind; job.notes.push(`Changed project type to ${shift.kind}`); }
  updateMessage(msgId, { meta: { status: "running", started: job.started, phase: "queued", model: model.name, job: job.id } });
  touch(project.id, { stage: "building" });
  const files = J(project.files, {});
  schedule(job, async () => {
    let used = model;
    try {
      step(job, "context", "Reading your project");
      const before = await inspect(files, project.title, { kind: job.kind, prompt: project.prompt });
      const baseline = new Set(before.issues.map(issueKey));
      // template projects: the shared libraries are read-only context; most changes are config edits
      const isTpl = !!(files["kit.js"] && files["icons.js"] && files["config.js"]);
      const ctxFiles = isTpl ? Object.fromEntries(Object.entries(files).filter(([p]) => !["kit.js", "icons.js"].includes(p))) : files;
      let req = `PROJECT TYPE: ${P.NOUN[job.kind]}\n`;
      if (isTpl) req += `This project uses the Stak Pro template. kit.js (window.Kit: store.get/set, toast, confirm, theme, money, date, esc, uid, download, copy) and icons.js (window.Icon(name,size) → Lucide SVG string; names: ${TPL.ICONS.join(", ")}) are shared read-only libraries — never rewrite them. Prefer editing config.js (window.APP: names, colours, fields, categories, persona, suggestions, copy) for content changes; patch app.js/styles.css only for new behaviour or layout. Keep the existing design tokens (--accent, --surface, --border, --r…) and classes.\n`;
      req += `CURRENT PROJECT FILES:\n${P.filesBlock(ctxFiles)}`;
      if (history) req += `\nRECENT CONVERSATION:\n${history}\n`;
      if (selection?.selector) req += `\nTHE USER SELECTED THIS ELEMENT in the preview (CSS path: ${selection.selector}${selection.label ? `, text: "${selection.label}"` : ""}):\n${String(selection.html || "").slice(0, 2400)}\nChange ONLY this element (and the CSS/JS it strictly needs) unless the request clearly says otherwise.\n`;
      step(job, "context", null, "done");
      req += await webContext(job, text, []);
      req += `\nUSER REQUEST:\n${text}`;
      step(job, "build", "Making the change");
      const out = await withFallback(job, model, async (m) => {
        const raw = { s: "" }; let last = 0, pump = makePump(job);
        const r = await call(job, m, {
          role: "build", system: P.EDIT_SYSTEM(lang, job.kind), maxTokens: 16000, temperature: 0.35,
          messages: [{ role: "user", content: req }],
          onRestart: (c) => { raw.s = ""; job.text += "\n"; pump = makePump(job); job.doneFiles = []; job.notes.push(`Switched to ${c.name} mid-edit`); },
          onText: (t) => { raw.s += t; pump(raw.s, false); const now = Date.now(); if (now - last > 200) { last = now; trackFiles(job, job.text); } },
        });
        pump(raw.s, true); trackFiles(job, job.text);
        if (r.modelName) { job.model = r.modelName; used = { ...m, name: r.modelName }; }
        return raw.s;
      });
      if (stopped(job)) throw STOP();
      let { files: newFiles, failed } = applyOutput(files, out);
      // patches that didn't apply → ask for the whole file once
      for (const p of failed.slice(0, 2)) {
        try {
          const r = await call(job, used.kind === "user" ? PRO : used, {
            role: "build", system: `Apply the change request to the file and return the COMPLETE updated file as <stak-file path="${p.path}">…</stak-file>. Nothing else.`, maxTokens: 16000, temperature: 0.2, maxAttempts: 3,
            messages: [{ role: "user", content: `REQUEST: ${text}\n${selection?.selector ? `Selected element: ${selection.selector}\n` : ""}\n<stak-file path="${p.path}">\n${newFiles[p.path] || ""}\n</stak-file>` }], onText: null,
          });
          const f = S.parseFiles(r.text); if (f[p.path]) newFiles[p.path] = f[p.path];
        } catch (e) { if (e.aborted) throw e; job.notes.push(`Couldn't fully apply the change to ${p.path}`); }
      }
      const summary = S.summaryOf(out);
      const changed = Object.keys(newFiles).filter((k) => newFiles[k] !== files[k]);
      step(job, "build", null, "done", changed.length ? `${changed.length} file${changed.length > 1 ? "s" : ""} changed` : "no changes");
      if (!changed.length) {
        updateMessage(msgId, { kind: "text", content: summary || "Done — nothing needed to change.", meta: { status: "done", model: used.name, report: { usage: job.usage, models: [...job.models], duration: Date.now() - job.started } } });
        touch(project.id, { stage: "ready" });
        job.status = "done"; persist(job); return;
      }
      if (CFG.images.commons && IMG.photoRefs(newFiles).length) {
        step(job, "photos", "Adding real photos");
        const p = await IMG.resolvePhotos(project.id, newFiles, { signal: job.ac.signal });
        newFiles = p.files; step(job, "photos", null, "done", `${p.resolved} photos`);
      }
      const final = await qa(job, newFiles, { title: project.title, kind: job.kind, prompt: text, used, baseline, lang });
      if (stopped(job)) throw STOP();
      const version = saveVersion(project.id, final.files, text.slice(0, 80), final.rules);
      const report = reportOf(job, final, { version, regressionGuard: true });
      updateMessage(msgId, { content: summary || "Done — your change is live in the preview.", meta: { status: "done", files: changed, duration: report.duration, version, model: used.name, notes: job.notes, report, job: job.id } });
      touch(project.id, { stage: "ready", kind: job.kind });
      job.status = "done"; job.phase = "done";
      persist(job, report);
      event(userId, "edit_done", project.id, project.title, `v${version}: ${text.slice(0, 120)}`);
      notify(userId, { title: `${project.title} updated`, body: "Your edit is ready on Stak", tag: project.id, url: `./#/p/${project.id}` });
    } catch (e) { fail(job, msgId, project, e, userId); }
    finally { job.finished = job.finished || Date.now(); if (job.status !== "done") persist(job); }
  });
  return job;
}

// converts raw edit output (with <stak-patch>) into the append-only display stream the frontend parses
function makePump(job) {
  let pos = 0, mode = "out", patchStart = 0;
  const OPEN = '<stak-patch path="';
  return function pump(raw, final) {
    for (;;) {
      if (mode === "out") {
        const i = raw.indexOf(OPEN, pos);
        if (i < 0) { const safe = final ? raw.length : Math.max(pos, raw.length - 40); job.text += raw.slice(pos, safe); pos = safe; return; }
        const close = raw.indexOf('">', i);
        if (close < 0) { job.text += raw.slice(pos, i); pos = i; return; }
        job.text += raw.slice(pos, i) + `<stak-edit path="${raw.slice(i + OPEN.length, close)}">\n`;
        pos = close + 2; patchStart = pos; mode = "patch";
      } else {
        const e = raw.indexOf("</stak-patch>", pos);
        if (e < 0) { if (final) { job.text += "</stak-edit>\n"; pos = raw.length; mode = "out"; } return; }
        const reps = [...raw.slice(patchStart, e).matchAll(/=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g)].map((m) => m[1]);
        job.text += (reps.join("\n/* … */\n") || "") + "\n</stak-edit>\n";
        pos = e + "</stak-patch>".length; mode = "out";
      }
    }
  };
}

module.exports = {
  jobs, jobView, activeJobFor, stopJob, startQuestions, startBuild, startEdit, briefFrom, addMessage, getMessage, updateMessage,
  touch, getProject, resolveModel, event, setPush, saveVersion, normalizeQuestions, ensureImagesQuestion, inspect, applyOutput, issueKey, PHOTO_IDEA,
};

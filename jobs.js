// Background jobs: questions, build, edit. Polled by the frontend via GET /api/jobs/:id?from=N
const { db, J, rid, decrypt } = require("./db");
const llm = require("./llm");
const P = require("./prompts");
const S = require("./site");
const WEB = require("./search");
const CFG = require("./config");

const jobs = new Map(); // id -> job
let running = 0;
const MAX_CONCURRENT = CFG.maxJobs || 4;
const queue = [];

function newJob(type, projectId, userId, modelName) {
  const job = {
    id: rid(16), type, projectId, userId, status: "running", phase: type === "questions" ? "thinking" : "thinking",
    text: "", doneFiles: [], started: Date.now(), error: null, model: modelName, plan: "", notes: [],
  };
  jobs.set(job.id, job);
  return job;
}
function activeJobFor(projectId) {
  for (const j of jobs.values()) if (j.projectId === projectId && j.status === "running") return j;
  return null;
}
function jobView(job, from = 0) {
  if (!job) return { status: "gone" };
  return {
    status: job.status, phase: job.phase, delta: job.text.slice(from), doneFiles: job.doneFiles,
    elapsed: Math.round((Date.now() - job.started) / 1000), error: job.error, type: job.type,
    model: job.model, plan: job.plan || undefined, sources: job.sources?.length ? job.sources : undefined, notes: job.notes.length ? job.notes : undefined,
  };
}
// GC finished jobs after 15 min
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of jobs) if (j.status !== "running" && now - (j.finished || now) > 15 * 60e3) jobs.delete(id);
}, 60e3).unref();

function schedule(fn) {
  return new Promise((resolve) => {
    const go = async () => { running++; try { await fn(); } finally { running--; resolve(); const n = queue.shift(); if (n) n(); } };
    if (running < MAX_CONCURRENT) go(); else queue.push(go);
  });
}

// ---- message helpers ----
function addMessage(projectId, role, kind, content, meta = {}) {
  const r = db.prepare("INSERT INTO messages(project_id,role,kind,content,meta,created) VALUES(?,?,?,?,?,?)")
    .run(projectId, role, kind, content, JSON.stringify(meta), Date.now());
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
function resolveModel(userId, wanted) {
  const id = String(wanted || "");
  const b = llm.builtin(id);
  if (b) return { kind: "builtin", id: b.id, name: b.name };
  if (id) {
    const row = db.prepare("SELECT * FROM models WHERE id=? AND user_id=?").get(id, userId);
    if (row && row.status === "ready") {
      return { kind: "user", id: row.id, name: row.name, baseUrl: row.base_url, apiKey: decrypt(row.api_key), model: row.model, result: J(row.result, {}) };
    }
  }
  return { kind: "builtin", id: "stak:pro", name: "Stak Pro" };
}
const PRO = { kind: "builtin", id: "stak:pro", name: "Stak Pro" };

// ---- notifications + event log (mobile app polls /api/mobile/events) ----
let pushSend = null;
function setPush(fn) { pushSend = fn; }
function notify(userId, payload) { try { pushSend && pushSend(userId, payload); } catch {} }
function event(userId, type, projectId, title, body) {
  try { db.prepare("INSERT INTO events(user_id,type,project_id,title,body,created) VALUES(?,?,?,?,?,?)").run(userId, type, projectId, String(title || "").slice(0, 120), String(body || "").slice(0, 300), Date.now()); }
  catch (e) { console.warn("[event]", e.message); }
}

// ---- real-time web research ----
function latestResearchQueries(projectId) {
  const m = db.prepare("SELECT meta FROM messages WHERE project_id=? AND kind='questions' ORDER BY id DESC LIMIT 1").get(projectId);
  const r = J(m?.meta, {}).research;
  return Array.isArray(r) ? r.map(String).filter(Boolean).slice(0, 4) : [];
}
// returns a prompt block ("" when nothing needed / found)
async function webContext(job, topic, queries) {
  if (!queries.length && !WEB.needsResearch(topic)) return "";
  const prev = job.phase; job.phase = "researching";
  try {
    const r = await Promise.race([WEB.research({ topic, queries, llm }), new Promise((res) => setTimeout(() => res(null), 75000))]);
    if (!r || !r.summary) return "";
    job.sources = r.sources || [];
    job.notes.push(`Researched the live web${r.sources?.length ? ` (${r.sources.length} sources)` : ""}`);
    return `\nLIVE WEB RESEARCH (fetched ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC — use these real facts instead of inventing; prefer the listed free live APIs via fetch()/stak.web for anything that changes over time; never show raw citations markup):\n${r.summary.slice(0, 6000)}\n${(r.sources || []).length ? `SOURCES:\n${r.sources.slice(0, 8).map((x) => `- ${x.url}`).join("\n")}\n` : ""}`;
  } catch (e) { console.warn("[research]", e.message); return ""; }
  finally { if (job.phase === "researching") job.phase = prev === "researching" ? "thinking" : prev; }
}

// ============ QUESTIONS ============
function normalizeQuestions(raw) {
  const qs = Array.isArray(raw) ? raw : [];
  const out = [];
  let k = 0, secrets = 0;
  for (const q of qs) {
    if (!q || !q.question) continue;
    let type = String(q.type || "single").toLowerCase();
    if (type === "choice" || type === "select" || type === "radio") type = "single";
    if (type === "checkbox" || type === "multiple") type = "multi";
    if (type === "image" || type === "upload" || type === "photos") type = "images";
    if (!["single", "multi", "text", "secret", "images"].includes(type)) type = "single";
    const item = { id: `q${++k}`, type, question: String(q.question).slice(0, 240) };
    if (type === "images") {
      item.slot = String(q.slot || "photos").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 24) || "photos";
      item.max = Math.max(1, Math.min(20, Number(q.max) || 12));
      const opts = (Array.isArray(q.options) ? q.options : []).map((o) => String(o || "").slice(0, 90)).filter(Boolean);
      item.options = [opts[0] || "Yes — I'll upload my own photos", opts[1] || "No — pick the best images for me"];
      if (q.aiNote) item.aiNote = String(q.aiNote).slice(0, 200);
    } else if (type === "secret") {
      if (secrets++ || !q.secretName) { k--; continue; }
      item.secretName = String(q.secretName).toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 40);
      if (q.placeholder) item.placeholder = String(q.placeholder).slice(0, 40);
      if (/^https:\/\//.test(q.helpUrl || "")) item.helpUrl = q.helpUrl;
      item.optional = true;
    } else if (type === "text") {
      item.placeholder = String(q.placeholder || "").slice(0, 120);
    } else {
      const opts = (Array.isArray(q.options) ? q.options : []).map((o) => String(typeof o === "object" ? o.label || o.value || "" : o).slice(0, 80)).filter(Boolean).slice(0, 6);
      if (opts.length < 2) { item.type = "text"; item.placeholder = String(q.placeholder || "").slice(0, 120); }
      else item.options = opts;
    }
    out.push(item);
  }
  const normal = out.filter((q) => q.type !== "secret" && q.type !== "images").slice(0, 5);
  const images = out.filter((q) => q.type === "images").slice(0, 2);
  // images questions go right after the question about sections/content (position 3), secrets last
  const list = [...normal.slice(0, 3), ...images, ...normal.slice(3), ...out.filter((q) => q.type === "secret")];
  return list.map((q, i) => ({ ...q, id: `q${i + 1}` }));
}

// photo-heavy ideas always get an upload question, even if the model forgot it
const PHOTO_IDEA = /portfolio|photo|gallery|wedding|restaurant|cafe|caf\u00e9|bakery|menu|dish|food|product|shop|store|boutique|fashion|jewel|salon|\bspa\b|hotel|resort|homestay|room|real ?estate|property|interior|architect|travel|tour|event|venue|gym|fitness|clinic|artist|\bart\b|tattoo|studio|team|catalog|furniture|\bcars?\b|\bbikes?\b|showroom|फोटो|दुकान|रेस्टोरेंट/i;
const IMG_Q = {
  en: ["Want to add your own photos for this section?", "Yes — I'll upload my own photos", "No — pick the best images for me", "No problem — Stak will create high-quality, on-theme photos for you."],
  hinglish: ["Is section ke liye apni photos daalna chahenge?", "Haan — main apni photos upload karunga", "Nahi — aap best images laga do", "Koi baat nahi — Stak aapke project ke hisaab se high-quality photos bana dega."],
  hi: ["क्या आप इस सेक्शन के लिए अपनी फ़ोटो डालना चाहेंगे?", "हाँ — मैं अपनी फ़ोटो अपलोड करूँगा", "नहीं — आप सबसे अच्छी इमेज लगा दें", "कोई बात नहीं — Stak आपके प्रोजेक्ट के हिसाब से बढ़िया फ़ोटो बना देगा।"],
};
function ensureImagesQuestion(questions, prompt, lang) {
  if (questions.some((q) => q.type === "images") || !PHOTO_IDEA.test(prompt)) return questions;
  const t = IMG_Q[lang] || IMG_Q.en;
  const q = { id: "qi", type: "images", slot: /portfolio|photo|wedding|gallery|फोटो/i.test(prompt) ? "portfolio" : "photos", max: 12, question: t[0], options: [t[1], t[2]], aiNote: t[3] };
  const normal = questions.filter((x) => x.type !== "secret");
  const list = [...normal.slice(0, 3), q, ...normal.slice(3), ...questions.filter((x) => x.type === "secret")];
  return list.map((x, i) => ({ ...x, id: `q${i + 1}` }));
}

function startQuestions({ project, userId, lang, wanted, msgId }) {
  const model = resolveModel(userId, wanted);
  const job = newJob("questions", project.id, userId, model.name);
  schedule(async () => {
    try {
      const ask = async (m) => {
        const text = await llm.complete(m, {
          role: "fast", system: P.QUESTIONS_SYSTEM(lang), maxTokens: 2000, temperature: 0.7,
          messages: [{ role: "user", content: `The user's idea:\n"""${project.prompt}"""` }],
        });
        const j = llm.parseJSON(text);
        const questions = ensureImagesQuestion(normalizeQuestions(j?.questions), project.prompt, lang);
        if (!j || questions.filter((q) => q.type !== "secret" && q.type !== "images").length < 3) throw new Error("Model returned invalid questions JSON");
        return { j, questions };
      };
      let r;
      try { r = await ask(model); }
      catch (e) { if (model.kind !== "user") throw e; job.notes.push(`${model.name} failed — used Stak Pro`); r = await ask(PRO); }
      const title = String(r.j.title || "").trim().slice(0, 60) || project.title;
      const intro = String(r.j.intro || "").trim() || "Love it! A few quick questions so I can nail this.";
      const research = Array.isArray(r.j.research) ? r.j.research.map((x) => String(x).slice(0, 200)).filter(Boolean).slice(0, 4) : [];
      updateMessage(msgId, { content: intro, meta: { status: "ready", questions: r.questions, research } });
      touch(project.id, { title, stage: "questions" });
      job.status = "done";
      event(userId, "questions_ready", project.id, title, intro.slice(0, 200));
      notify(userId, { title: `${title}: a few quick questions`, body: "Answer them to start the build", tag: project.id, url: `./#/app/${project.id}` });
    } catch (e) {
      console.error("[questions]", e.message);
      updateMessage(msgId, { content: "", meta: { status: "error", error: e.message } });
      job.status = "error"; job.error = friendly(e);
      event(userId, "job_failed", project.id, project.title, job.error);
    } finally { job.finished = Date.now(); job.phase = "done"; }
  });
  return job;
}

function friendly(e) {
  const m = String(e?.message || e || "Something went wrong");
  if (/rate|429/i.test(m)) return "The AI is busy right now — please retry in a moment.";
  if (/timed? ?out|abort/i.test(m)) return "The AI took too long — please retry.";
  return m.slice(0, 300);
}

// ============ STREAM TRACKING ============
function trackFiles(job, text) {
  // derive current file + finished files from the (display) text
  const re = /<stak-(file|edit) path="([^"]+)">/g;
  let m, last = null;
  const done = new Set(job.doneFiles);
  while ((m = re.exec(text))) {
    const closeAt = text.indexOf(`</stak-${m[1]}>`, m.index);
    if (closeAt >= 0) done.add(m[2]); else last = m[2];
  }
  job.doneFiles = [...done];
  if (last) job.phase = `writing:${last}`;
  else if (job.doneFiles.length && job.phase.startsWith("writing:")) job.phase = "finishing";
}

function briefFrom(project, { answers, notes, skip, questions }) {
  let s = `PROJECT IDEA:\n${project.prompt}\n`;
  if (skip) s += `\nThe user skipped the questions — choose excellent, specific defaults yourself (audience, style, sections, features) that fit the idea best.\n`;
  else if (questions?.length) {
    s += `\nTHE USER'S ANSWERS:\n`;
    for (const q of questions) {
      if (q.type === "secret" || q.type === "images") continue;
      const a = answers?.[q.id];
      s += `- ${q.question}\n  → ${a && a.length ? a.join(", ") : "(no preference — you decide)"}\n`;
    }
  }
  // photos per section: user uploads only (AI image generation is DISABLED)
  for (const q of (questions || []).filter((x) => x.type === "images")) {
    const ups = (answers?.[q.id] || []).filter((v) => String(v).startsWith("upload:assets/")).map((v) => String(v).slice(7));
    if (ups.length) s += `\nUSER-UPLOADED PHOTOS for the "${q.slot}" section (${q.question}) — use ALL of these exact paths there, in this order:\n${ups.map((u) => "- " + u).join("\n")}\n`;
    else s += `\nPHOTOS for the "${q.slot}" section: AI image generation is DISABLED. Use CSS gradients, SVGs, or Unsplash URLs (https://images.unsplash.com/...) for visuals instead.\n`;
  }
  if (notes) s += `\nEXTRA NOTES FROM THE USER:\n${notes}\n`;
  return s;
}

// Image generation is DISABLED — assetsBlock and makeImages removed for speed

// ============ BUILD ============
function startBuild({ project, userId, lang, wanted, msgId, brief, label = "Build" }) {
  const model = resolveModel(userId, wanted);
  const job = newJob("build", project.id, userId, model.name);
  touch(project.id, { stage: "building" });
  updateMessage(msgId, { meta: { status: "running", started: job.started, phase: "thinking", model: model.name } });
  schedule(async () => {
    let used = model;
    try {
      let plan = "";
      if (model.kind === "builtin" && model.id === "stak:think") {
        job.phase = "planning";
        const r = await llm.stream(model, {
          role: "plan", system: P.PLAN_SYSTEM(lang), maxTokens: 1500, temperature: 0.5,
          messages: [{ role: "user", content: brief }],
          onText: (_t, all) => { job.plan = all; },
        });
        plan = r.text.trim(); job.plan = plan;
      }
      const web = await webContext(job, brief, latestResearchQueries(project.id));
      job.phase = "thinking";
      const userMsg = brief + web + (plan ? `\nBUILD PLAN (follow it):\n${plan}\n` : "") +
        `\nWrite the complete site now. Language for all visible copy: ${P.langName(lang)}.`;
      const run = async (m) => {
        let startLen = job.text.length;
        let last = 0;
        const r = await llm.stream(m, {
          role: "build", system: P.BUILD_SYSTEM(lang), maxTokens: 32000, temperature: 0.6,
          messages: [{ role: "user", content: userMsg }],
          onRestart: (c) => { job.text += "\n"; startLen = job.text.length; job.doneFiles = []; job.notes.push(`Switched to ${c.name} mid-build`); job.phase = "thinking"; },
          onFallback: (c) => { job.model = `${c.name} · ${c.by}`; },
          onText: (t) => {
            // Check if job was stopped
            if (job.status === "stopped") throw new Error("Job stopped by user");
            job.text += t;
            const now = Date.now();
            if (now - last > 250) { last = now; trackFiles(job, job.text.slice(startLen)); }
          },
          onThinking: () => { job.phase = "thinking"; },
        });
        const out = job.text.slice(startLen);
        trackFiles(job, out);
        const files = S.parseFiles(out);
        if (!files["index.html"]) throw new Error(r.stop === "max_tokens" ? "The site was too large for one pass — try Stak Pro or a simpler request" : "Model did not return a valid index.html");
        if (r.modelName) { job.model = r.modelName; used = { ...m, name: r.modelName }; }
        // Image generation disabled — no externalizeStock, no stak-image tags
        return { files, summary: S.summaryOf(out), out };
      };
      let res;
      try { res = await run(model); }
      catch (e) {
        if (model.kind !== "user") throw e;
        console.warn("[build] user model failed, falling back:", e.message);
        job.notes.push(`${model.name} failed (${String(e.message).slice(0, 80)}) — rebuilt with Stak Pro`);
        job.text += "\n"; used = PRO; job.model = PRO.name;
        res = await run(PRO);
      }
      // Check if job was stopped before QA
      if (job.status === "stopped") throw new Error("Job stopped by user");
      const final = await qa(job, res.files, project.title, lang, used);
      job.phase = "finishing";
      saveVersion(project.id, final.files, label);
      const version = getProject(project.id).version;
      updateMessage(msgId, {
        content: res.summary || "Your site is ready — have a look at the preview.",
        meta: {
          status: "done", files: Object.keys(final.files), duration: Date.now() - job.started, version,
          model: used.name, notes: job.notes, verify: { fixed: final.fixed, remaining: final.remaining.map((r) => `${r.file}: ${r.problem}`), images: 0 },
        },
      });
      touch(project.id, { stage: "ready" });
      job.status = "done";
      event(userId, "build_done", project.id, getProject(project.id).title, `v${version} is live${job.sources?.length ? " · used live web data" : ""}`);
      notify(userId, { title: `${getProject(project.id).title} is ready`, body: "Your build finished on Stak", tag: project.id, url: `./#/app/${project.id}` });
    } catch (e) {
      if (e.message === "Job stopped by user") {
        job.status = "stopped";
        job.error = "Stopped by user";
        updateMessage(msgId, { meta: { status: "error", error: "Stopped by user" } });
        touch(project.id, { stage: getProject(project.id).version > 0 ? "ready" : "error" });
        return;
      }
      console.error("[build]", e.message);
      job.status = "error"; job.error = friendly(e);
      updateMessage(msgId, { meta: { status: "error", error: job.error } });
      event(userId, "job_failed", project.id, project.title, job.error);
      const p = getProject(project.id);
      touch(project.id, { stage: p.version > 0 ? "ready" : "error" });
    } finally { job.finished = Date.now(); }
  });
  return job;
}

// verification + one repair round for files with problems
async function qa(job, files, title, lang, used = PRO) {
  const setPhase = (p) => { if (!String(job.phase).startsWith("images:")) job.phase = p; };
  setPhase("verifying");
  let v = await S.verifyFull(files, title);
  const bad = [...new Set(v.remaining.map((r) => r.file))].filter((f) => !!v.files[f]);
  if (bad.length) {
    setPhase("repairing");
    let repaired = 0;
    const repairModel = used && used.kind === "user" ? used : PRO;
    const deadline = Date.now() + 4 * 60e3;
    for (const f of bad.slice(0, 3)) {
      const problems = v.remaining.filter((r) => r.file === f).map((r) => "- " + r.problem).join("\n");
      if (Date.now() > deadline) break;
      try {
        const text = await llm.complete(repairModel, {
          role: "build", system: P.REPAIR_SYSTEM, maxTokens: 32000, temperature: 0.2, maxAttempts: 2,
          messages: [{ role: "user", content: `Other files in the project: ${Object.keys(v.files).join(", ")}\nProblems in ${f}:\n${problems}\n\n<stak-file path="${f}">\n${v.files[f]}\n</stak-file>` }],
        });
        const fixedFiles = S.parseFiles(text);
        if (fixedFiles[f]) { v.files[f] = fixedFiles[f]; repaired++; }
      } catch (e) { console.warn("[repair]", e.message); }
    }
    const before = v.fixed;
    const v2 = await S.verifyFull(v.files, title);
    v = { ...v2, fixed: before + v2.fixed + Math.max(0, v.remaining.length - v2.remaining.length) };
    void repaired;
  }
  setPhase("finishing");
  return v;
}

function saveVersion(projectId, files, label) {
  files = S.withKit(files);
  const p = getProject(projectId);
  const n = (db.prepare("SELECT MAX(n) m FROM versions WHERE project_id=?").get(projectId).m || 0) + 1;
  db.prepare("INSERT INTO versions(project_id,n,label,files,created) VALUES(?,?,?,?,?)").run(projectId, n, String(label).slice(0, 80), JSON.stringify(files), Date.now());
  touch(projectId, { files: JSON.stringify(files), version: n });
  void p;
  return n;
}

// ============ EDIT ============
function startEdit({ project, userId, lang, wanted, msgId, text, selection, history }) {
  const model = resolveModel(userId, wanted);
  const job = newJob("edit", project.id, userId, model.name);
  job.phase = "thinking";
  updateMessage(msgId, { meta: { status: "running", started: job.started, phase: "thinking", model: model.name } });
  touch(project.id, { stage: "building" });
  const files = J(project.files, {});
  schedule(async () => {
    let used = model;
    try {
      let req = `CURRENT PROJECT FILES:\n${P.filesBlock(files)}`;
      if (history) req += `\nRECENT CONVERSATION:\n${history}\n`;
      if (selection?.selector) {
        req += `\nTHE USER SELECTED THIS ELEMENT in the preview (CSS path: ${selection.selector}${selection.label ? `, text: "${selection.label}"` : ""}):\n${String(selection.html || "").slice(0, 2400)}\nChange ONLY this element (and the CSS/JS it strictly needs) unless the request clearly says otherwise.\n`;
      }
      req += await webContext(job, text, []);
      job.phase = "thinking";
      req += `\nUSER REQUEST:\n${text}`;
      const run = async (m) => {
        const raw = { s: "" };
        let last = 0;
        let pump = makePump(job);
        const r = await llm.stream(m, {
          role: "build", system: P.EDIT_SYSTEM(lang), maxTokens: 32000, temperature: 0.4,
          messages: [{ role: "user", content: req }],
          onRestart: (c) => { raw.s = ""; job.text += "\n"; pump = makePump(job); job.doneFiles = []; job.notes.push(`Switched to ${c.name} mid-edit`); },
          onText: (t) => {
            // Check if job was stopped
            if (job.status === "stopped") throw new Error("Job stopped by user");
            raw.s += t; pump(raw.s, false);
            const now = Date.now();
            if (now - last > 250) { last = now; trackFiles(job, job.text); }
          },
        });
        pump(raw.s, true); trackFiles(job, job.text);
        if (r.modelName) { job.model = r.modelName; used = { ...m, name: r.modelName }; }
        return raw.s;
      };
      let out;
      try { out = await run(model); }
      catch (e) {
        if (model.kind !== "user") throw e;
        job.notes.push(`${model.name} failed — edited with Stak Pro`); used = PRO; job.model = PRO.name; job.text += "\n";
        out = await run(PRO);
      }
      // Check if job was stopped
      if (job.status === "stopped") throw new Error("Job stopped by user");
      let newFiles = { ...files };
      const full = S.parseFiles(out);
      Object.assign(newFiles, full);
      const failed = [];
      for (const p of S.parsePatches(out)) {
        if (newFiles[p.path] === undefined) { failed.push(p); continue; }
        let src = newFiles[p.path], bad = 0;
        for (const b of p.blocks) { const r = S.applyBlock(src, b); if (r.ok) src = r.src; else bad++; }
        newFiles[p.path] = src;
        if (bad) failed.push(p);
      }
      // fallback for patches that didn't apply: ask for the whole file
      for (const p of failed.slice(0, 2)) {
        job.phase = "repairing";
        try {
          const t = await llm.complete(used.kind === "user" ? PRO : used, {
            role: "build", system: P.REPAIR_SYSTEM, maxTokens: 32000, temperature: 0.2,
            messages: [{ role: "user", content: `Apply this change request to the file and return the complete updated file.\nREQUEST: ${text}\n${selection?.selector ? `Selected element: ${selection.selector}\n` : ""}\n<stak-file path="${p.path}">\n${newFiles[p.path] || ""}\n</stak-file>` }],
          });
          const f = S.parseFiles(t);
          if (f[p.path]) newFiles[p.path] = f[p.path];
        } catch (e) { job.notes.push(`Couldn't fully apply the change to ${p.path}`); }
      }
      // Image generation disabled — no externalizeStock, no stak-image tags
      const summary = S.summaryOf(out);
      const changed = Object.keys(newFiles).filter((k) => newFiles[k] !== files[k]);
      if (!changed.length) {
        // pure chat answer
        updateMessage(msgId, { kind: "text", content: summary || "Done — nothing needed to change.", meta: { status: "done", model: used.name } });
        touch(project.id, { stage: "ready" });
        job.status = "done";
        return;
      }
      // Check if job was stopped before QA
      if (job.status === "stopped") throw new Error("Job stopped by user");
      const final = await qa(job, newFiles, project.title, lang, used);
      job.phase = "finishing";
      saveVersion(project.id, final.files, text.slice(0, 80));
      const version = getProject(project.id).version;
      updateMessage(msgId, {
        content: summary || "Done — your change is live in the preview.",
        meta: {
          status: "done", files: changed, duration: Date.now() - job.started, version, model: used.name, notes: job.notes,
          verify: { fixed: final.fixed, remaining: final.remaining.map((r) => `${r.file}: ${r.problem}`), images: 0 },
        },
      });
      touch(project.id, { stage: "ready" });
      job.status = "done";
      event(userId, "edit_done", project.id, project.title, `v${version}: ${text.slice(0, 120)}`);
      notify(userId, { title: `${project.title} updated`, body: "Your edit is ready on Stak", tag: project.id, url: `./#/app/${project.id}` });
    } catch (e) {
      if (e.message === "Job stopped by user") {
        job.status = "stopped";
        job.error = "Stopped by user";
        updateMessage(msgId, { meta: { status: "error", error: "Stopped by user" } });
        touch(project.id, { stage: getProject(project.id).version > 0 ? "ready" : "error" });
        return;
      }
      console.error("[edit]", e.message);
      job.status = "error"; job.error = friendly(e);
      updateMessage(msgId, { meta: { status: "error", error: job.error } });
      event(userId, "job_failed", project.id, project.title, job.error);
      touch(project.id, { stage: getProject(project.id).version > 0 ? "ready" : "error" });
    } finally { job.finished = Date.now(); }
  });
  return job;
}

// converts raw edit output (with <stak-patch>) into the append-only display stream the frontend parses
function makePump(job) {
  let pos = 0, mode = "out", patchPath = "", patchStart = 0;
  const OPEN = '<stak-patch path="';
  return function pump(raw, final) {
    for (;;) {
      if (mode === "out") {
        const i = raw.indexOf(OPEN, pos);
        if (i < 0) {
          const safe = final ? raw.length : Math.max(pos, raw.length - 40);
          job.text += raw.slice(pos, safe); pos = safe; return;
        }
        const close = raw.indexOf('">', i);
        if (close < 0) { job.text += raw.slice(pos, i); pos = i; return; }
        job.text += raw.slice(pos, i);
        patchPath = raw.slice(i + OPEN.length, close);
        job.text += `<stak-edit path="${patchPath}">\n`;
        pos = close + 2; patchStart = pos; mode = "patch";
      } else {
        const e = raw.indexOf("</stak-patch>", pos);
        if (e < 0) { if (final) { job.text += "</stak-edit>\n"; pos = raw.length; mode = "out"; } return; }
        const body = raw.slice(patchStart, e);
        const reps = [...body.matchAll(/=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g)].map((m) => m[1]);
        job.text += (reps.join("\n/* … */\n") || "") + "\n</stak-edit>\n";
        pos = e + "</stak-patch>".length; mode = "out";
      }
    }
  };
}

module.exports = {
  jobs, jobView, activeJobFor, startQuestions, startBuild, startEdit, briefFrom, addMessage, getMessage, updateMessage,
  touch, getProject, resolveModel, event, setPush, saveVersion, normalizeQuestions,
};

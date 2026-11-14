// Background jobs: questions, build, edit. Polled by the frontend via GET /api/jobs/:id?from=N
//
// v4: jobs are persisted in the DB (table `jobs`) so that polling, stopping and the mobile app
// work across serverless instances. The instance that runs a job keeps it in memory, flushes
// text/phase/files every ~700 ms (+ heartbeat) and checks the DB stop flag on every flush.
// Stop is real: an AbortController cancels the upstream model request immediately.
const { db, J, rid } = require("./db");
const llm = require("./llm");
const P = require("./prompts");
const S = require("./site");
const WEB = require("./search");
const CFG = require("./config");

const jobs = new Map(); // id -> live job (this instance only)
let running = 0;
const MAX_CONCURRENT = CFG.maxJobs || 6;
const queue = [];
const STALE_MS = 45e3;
const SHOWN_MODEL = "Stak";

// ---------------------------------------------------------------- persistence
async function persist(job, final = false) {
  job.beat = Date.now();
  try {
    await db.run(
      "UPDATE jobs SET status=?,phase=?,text=?,done_files=?,model=?,plan=?,notes=?,sources=?,error=?,beat=?,finished=? WHERE id=?",
      job.status, job.phase, job.text, JSON.stringify(job.doneFiles), job.model, job.plan || "", JSON.stringify(job.notes),
      JSON.stringify(job.sources || []), job.error, job.beat, job.finished || null, job.id);
    if (!final && job.status === "running") {
      const r = await db.get("SELECT stop FROM jobs WHERE id=?", job.id);
      if (r && Number(r.stop)) abortJob(job);
    }
  } catch (e) { console.warn("[jobs] persist", e.message); }
}
function startFlusher(job) {
  let busy = false;
  job.timer = setInterval(async () => {
    if (busy) return; busy = true;
    try { await persist(job); } finally { busy = false; }
  }, 700);
  job.timer.unref?.();
}
function abortJob(job) {
  if (job.stopped) return;
  job.stopped = true;
  try { job.ac.abort(); } catch {}
}

async function newJob(type, projectId, userId) {
  const job = {
    id: rid(16), type, projectId, userId, status: "running", phase: "thinking",
    text: "", doneFiles: [], started: Date.now(), error: null, model: SHOWN_MODEL, plan: "", notes: [], sources: [],
    ac: new AbortController(), stopped: false, deadline: Date.now() + CFG.jobBudgetMs,
  };
  await db.run("INSERT INTO jobs(id,type,project_id,user_id,status,phase,text,done_files,model,plan,notes,sources,error,stop,started,beat,finished) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    job.id, type, projectId, userId, "running", "thinking", "", "[]", SHOWN_MODEL, "", "[]", "[]", null, 0, job.started, job.started, null);
  jobs.set(job.id, job);
  startFlusher(job);
  return job;
}
async function finishJob(job) {
  clearInterval(job.timer);
  job.finished = Date.now();
  if (job.status === "running") job.status = "done";
  await persist(job, true);
  setTimeout(() => jobs.delete(job.id), 5 * 60e3).unref?.();
}

const rowToJob = (r) => r && ({
  id: r.id, type: r.type, projectId: r.project_id, userId: r.user_id, status: r.status, phase: r.phase, text: r.text || "",
  doneFiles: J(r.done_files, []), model: r.model, plan: r.plan, notes: J(r.notes, []), sources: J(r.sources, []), error: r.error,
  started: Number(r.started), beat: Number(r.beat), finished: r.finished ? Number(r.finished) : null, stop: Number(r.stop),
});

// a job whose runner died (instance recycled / timed out) stops sending heartbeats → mark it interrupted
async function reapIfStale(j) {
  if (!j || j.status !== "running" || jobs.has(j.id) || Date.now() - j.beat < STALE_MS) return j;
  j.status = "error"; j.error = "The build was interrupted — tap Retry to continue."; j.finished = Date.now();
  await db.run("UPDATE jobs SET status='error', error=?, finished=? WHERE id=? AND status='running'", j.error, j.finished, j.id);
  const m = await db.get("SELECT id, meta FROM messages WHERE project_id=? ORDER BY id DESC LIMIT 1", j.projectId);
  if (m && ["running", "loading"].includes(J(m.meta, {}).status)) await updateMessage(m.id, { meta: { status: "error", error: j.error } });
  const p = await getProject(j.projectId);
  if (p && p.stage === "building") await touch(j.projectId, { stage: Number(p.version) > 0 ? "ready" : "error" });
  return j;
}

async function getJob(id) {
  const live = jobs.get(id);
  if (live) return live;
  return reapIfStale(rowToJob(await db.get("SELECT * FROM jobs WHERE id=?", id)));
}
async function activeJobFor(projectId) {
  for (const j of jobs.values()) if (j.projectId === projectId && j.status === "running") return j;
  const r = rowToJob(await db.get("SELECT * FROM jobs WHERE project_id=? AND status='running' ORDER BY started DESC LIMIT 1", projectId));
  const j = await reapIfStale(r);
  return j && j.status === "running" ? j : null;
}
async function activeJobsForUser(userId) {
  const rows = (await db.all("SELECT * FROM jobs WHERE user_id=? AND status='running' ORDER BY started DESC LIMIT 20", userId)).map(rowToJob);
  const out = [];
  for (const r of rows) { const j = jobs.get(r.id) || (await reapIfStale(r)); if (j.status === "running") out.push(j); }
  return out;
}
async function runningCount() { const r = await db.get("SELECT COUNT(*) AS c FROM jobs WHERE status='running'"); return Number(r?.c || 0); }

function jobView(job, from = 0) {
  if (!job) return { status: "gone" };
  // stopped jobs end the frontend's poll loop like errors do, with a calm message
  const status = job.status === "stopped" ? "error" : job.status;
  return {
    status, phase: job.phase, delta: job.text.slice(from), doneFiles: job.doneFiles,
    elapsed: Math.round(((job.finished || Date.now()) - job.started) / 1000), error: job.error, type: job.type,
    model: SHOWN_MODEL, plan: job.plan || undefined, sources: job.sources?.length ? job.sources : undefined, notes: job.notes?.length ? job.notes : undefined,
    stopped: job.status === "stopped" || undefined,
  };
}

// Stop: works from any instance — sets the DB flag (runner sees it within ~0.7 s) and aborts locally if we own it.
async function stopJob(job) {
  await db.run("UPDATE jobs SET stop=1 WHERE id=?", job.id);
  const live = jobs.get(job.id);
  if (live) { abortJob(live); return true; }
  // runner is elsewhere: if its heartbeat is stale, finalize here
  const j = await getJob(job.id);
  if (j && j.status === "running" && Date.now() - j.beat > 5000) {
    await db.run("UPDATE jobs SET status='stopped', error='Stopped', finished=? WHERE id=?", Date.now(), job.id);
    await markStopped(j.projectId, null);
  }
  return true;
}

// Run work in the background. On Vercel the response is sent first and waitUntil keeps the function alive.
function schedule(fn) {
  const p = new Promise((resolve) => {
    const go = async () => { running++; try { await fn(); } catch (e) { console.error("[jobs] uncaught", e); } finally { running--; resolve(); const n = queue.shift(); if (n) n(); } };
    if (running < MAX_CONCURRENT) go(); else queue.push(go);
  });
  if (CFG.serverless) { try { require("@vercel/functions").waitUntil(p); } catch {} }
  return p;
}

// ---------------------------------------------------------------- message helpers
async function addMessage(projectId, role, kind, content, meta = {}) {
  return db.insertId("INSERT INTO messages(project_id,role,kind,content,meta,created) VALUES(?,?,?,?,?,?)", projectId, role, kind, content, JSON.stringify(meta), Date.now());
}
async function getMessage(id) { const m = await db.get("SELECT * FROM messages WHERE id=?", id); if (m) m.meta = J(m.meta, {}); return m; }
async function updateMessage(id, patch) {
  const m = await getMessage(id); if (!m) return;
  const meta = patch.meta ? { ...m.meta, ...patch.meta } : m.meta;
  await db.run("UPDATE messages SET content=?, kind=?, meta=? WHERE id=?", patch.content ?? m.content, patch.kind ?? m.kind, JSON.stringify(meta), id);
}
const ALLOWED = new Set(["title", "stage", "files", "version", "answers", "notes", "prompt", "lang"]);
async function touch(projectId, fields = {}) {
  const keys = Object.keys(fields).filter((k) => ALLOWED.has(k));
  await db.run(`UPDATE projects SET ${[...keys.map((k) => `${k}=?`), "updated=?"].join(",")} WHERE id=?`, ...keys.map((k) => fields[k]), Date.now(), projectId);
}
const getProject = (id) => db.get("SELECT * FROM projects WHERE id=?", id);

async function markStopped(projectId, msgId) {
  if (msgId) await updateMessage(msgId, { meta: { status: "error", error: "Stopped. Tap Retry to run it again.", stopped: true } });
  const p = await getProject(projectId);
  if (p) await touch(projectId, { stage: Number(p.version) > 0 ? "ready" : "error" });
}

// The model picker is gone: everything is automatic. Kept for API compatibility.
function resolveModel() { return { kind: "builtin", id: "stak:auto", name: SHOWN_MODEL }; }

// ---------------------------------------------------------------- notifications + event log
let pushSend = null;
function setPush(fn) { pushSend = fn; }
function notify(userId, payload) { try { pushSend && Promise.resolve(pushSend(userId, payload)).catch(() => {}); } catch {} }
async function event(userId, type, projectId, title, body) {
  try { await db.run("INSERT INTO events(user_id,type,project_id,title,body,created) VALUES(?,?,?,?,?,?)", userId, type, projectId, String(title || "").slice(0, 120), String(body || "").slice(0, 300), Date.now()); }
  catch (e) { console.warn("[event]", e.message); }
}

// ---------------------------------------------------------------- live web research
async function latestResearchQueries(projectId) {
  const m = await db.get("SELECT meta FROM messages WHERE project_id=? AND kind='questions' ORDER BY id DESC LIMIT 1", projectId);
  const r = J(m?.meta, {}).research;
  return Array.isArray(r) ? r.map(String).filter(Boolean).slice(0, 3) : [];
}
async function webContext(job, topic, queries) {
  if (!queries.length && !WEB.needsResearch(topic)) return "";
  const prev = job.phase; job.phase = "researching";
  try {
    const r = await Promise.race([WEB.research({ topic, queries, llm, signal: job.ac.signal }), new Promise((res) => setTimeout(() => res(null), 35000))]);
    if (!r || !r.summary) return "";
    job.sources = r.sources || [];
    job.notes.push(`Researched the live web${r.sources?.length ? ` (${r.sources.length} sources)` : ""}`);
    return `\nLIVE WEB RESEARCH (fetched ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC — use these real facts instead of inventing; prefer the listed free live APIs via fetch() for anything that changes over time; never show raw citation markup):\n${r.summary.slice(0, 5000)}\n${(r.sources || []).length ? `SOURCES:\n${r.sources.slice(0, 8).map((x) => `- ${x.url}`).join("\n")}\n` : ""}`;
  } catch (e) { console.warn("[research]", e.message); return ""; }
  finally { if (job.phase === "researching") job.phase = prev === "researching" ? "thinking" : prev; }
}

function friendly(e) {
  const m = String(e?.message || e || "Something went wrong");
  if (/rate|429|quota|busy|overloaded|503/i.test(m)) return "Stak is very busy right now. Please tap Retry in a moment.";
  if (/timed? ?out|abort|deadline/i.test(m)) return "This took too long. Please tap Retry — it usually works on the second try.";
  if (/no model provider/i.test(m)) return "The server is not configured yet (missing provider keys).";
  return m.replace(/\b(AI|LLM|model)\b/gi, "engine").slice(0, 300);
}

// ============ QUESTIONS ============
function normalizeQuestions(raw) {
  const qs = Array.isArray(raw) ? raw : [];
  const out = [];
  let secrets = 0;
  for (const q of qs) {
    if (!q || !q.question) continue;
    let type = String(q.type || "single").toLowerCase();
    if (type === "choice" || type === "select" || type === "radio") type = "single";
    if (type === "checkbox" || type === "multiple") type = "multi";
    // v4: no photo/image questions — photos are chosen automatically
    if (/image|upload|photo/.test(type) || /\b(photos?|images?|pictures?|logo)\b/i.test(q.question) && /upload|own|apni|अपनी/i.test(q.question)) continue;
    if (!["single", "multi", "text", "secret"].includes(type)) type = "single";
    const item = { id: "", type, question: String(q.question).slice(0, 240) };
    if (type === "secret") {
      if (secrets++ || !q.secretName) continue;
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
  const list = [...out.filter((q) => q.type !== "secret").slice(0, 4), ...out.filter((q) => q.type === "secret")];
  return list.map((q, i) => ({ ...q, id: `q${i + 1}` }));
}

function defaultQuestions(prompt) {
  const app = llm.classify(prompt) === "app";
  return normalizeQuestions(app ? [
    { question: "What matters most in the first version?", type: "multi", options: ["Fast and simple", "Lots of features", "Works offline on phone", "Looks premium"] },
    { question: "Which look do you prefer?", type: "single", options: ["Clean light", "Sleek dark", "Colorful and playful", "Match my brand"] },
    { question: "Anything specific it must do?", type: "text", placeholder: "e.g. export to CSV, login, charts…" },
  ] : [
    { question: "What should visitors do first?", type: "single", options: ["Contact or call", "Book or order", "See work / gallery", "Sign up"] },
    { question: "Which style fits best?", type: "single", options: ["Clean and minimal", "Bold and modern", "Warm and friendly", "Luxury"] },
    { question: "Name, city or details to include?", type: "text", placeholder: "e.g. business name, phone, address…" },
  ]);
}

async function startQuestions({ project, userId, lang, msgId }) {
  const job = await newJob("questions", project.id, userId);
  schedule(async () => {
    try {
      // two tries; if the engines still return nothing usable, fall back to sensible default questions (never block the user)
      let j = null, questions = [];
      for (let attempt = 0; attempt < 2 && questions.filter((q) => q.type !== "secret").length < 2; attempt++) {
        try {
          const text = await llm.complete(null, {
            role: "fast", signal: job.ac.signal, deadline: job.deadline, system: P.QUESTIONS_SYSTEM(lang), maxTokens: 1800, temperature: attempt ? 0.3 : 0.6, maxAttempts: 4,
            messages: [{ role: "user", content: `The user's idea:\n"""${project.prompt}"""` }],
          });
          j = llm.parseJSON(text);
          questions = normalizeQuestions(j?.questions);
        } catch (e) { if (e.stopped || job.stopped) throw e; console.warn("[questions] try", attempt + 1, e.message); }
      }
      if (questions.filter((q) => q.type !== "secret").length < 2) { j = { title: project.title, intro: "" }; questions = defaultQuestions(project.prompt); }
      const title = String(j.title || "").trim().slice(0, 60) || project.title;
      const intro = String(j.intro || "").trim() || "A few quick questions so I can get this exactly right.";
      const research = Array.isArray(j.research) ? j.research.map((x) => String(x).slice(0, 200)).filter(Boolean).slice(0, 3) : [];
      await updateMessage(msgId, { content: intro, meta: { status: "ready", questions, research } });
      await touch(project.id, { title, stage: "questions" });
      job.status = "done";
      // approval needed → notify (web push + mobile app event)
      await event(userId, "questions_ready", project.id, title, intro.slice(0, 200));
      notify(userId, { title: `${title}: your answers are needed`, body: "Answer a few quick questions to start the build", tag: project.id, url: `./#/app/${project.id}` });
    } catch (e) {
      if (e.stopped || job.stopped) { job.status = "stopped"; job.error = "Stopped"; await markStopped(project.id, msgId); return; }
      console.error("[questions]", e.message);
      job.status = "error"; job.error = friendly(e);
      await updateMessage(msgId, { content: "", meta: { status: "error", error: job.error } });
      await event(userId, "job_failed", project.id, project.title, job.error);
    } finally { job.phase = "done"; await finishJob(job); }
  });
  return job;
}

// ============ STREAM TRACKING ============
function trackFiles(job, text) {
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
  if (skip) s += `\nThe user skipped the questions — choose excellent, specific defaults yourself (audience, style, features) that fit the idea best.\n`;
  else if (questions?.length) {
    s += `\nTHE USER'S ANSWERS:\n`;
    for (const q of questions) {
      if (q.type === "secret" || q.type === "images") continue;
      const a = answers?.[q.id];
      s += `- ${q.question}\n  → ${a && a.length ? a.join(", ") : "(no preference — you decide)"}\n`;
    }
  }
  const ups = Object.values(answers || {}).flat().filter((v) => String(v).startsWith("upload:assets/")).map((v) => String(v).slice(7));
  if (ups.length) s += `\nUSER-UPLOADED PHOTOS — use ALL of these exact paths where they fit best:\n${ups.map((u) => "- " + u).join("\n")}\n`;
  if (notes) s += `\nEXTRA NOTES FROM THE USER:\n${notes}\n`;
  return s;
}

const isStop = (e, job) => e?.stopped || job.stopped;

// ============ BUILD ============
async function startBuild({ project, userId, lang, msgId, brief, label = "Build" }) {
  const job = await newJob("build", project.id, userId);
  await touch(project.id, { stage: "building" });
  await updateMessage(msgId, { meta: { status: "running", started: job.started, phase: "thinking", model: SHOWN_MODEL } });
  const kind = llm.classify(`${project.prompt}\n${brief}`);
  schedule(async () => {
    try {
      const web = await webContext(job, brief, await latestResearchQueries(project.id));
      if (job.stopped) throw { stopped: true };
      job.phase = "thinking";
      const userMsg = brief + web + `\nWrite the complete ${kind === "app" ? "working app" : "site"} now. Language for all visible copy: ${P.langName(lang)}.`;
      let startLen = 0, last = 0, realModel = "";
      const r = await llm.stream(null, {
        role: "build", kind, signal: job.ac.signal, deadline: job.deadline,
        system: P.BUILD_SYSTEM(lang, kind), maxTokens: 32000, temperature: 0.5,
        messages: [{ role: "user", content: userMsg }],
        onRestart: () => { job.text += "\n"; startLen = job.text.length; job.doneFiles = []; job.phase = "thinking"; },
        onText: (t) => {
          job.text += t;
          const now = Date.now();
          if (now - last > 250) { last = now; trackFiles(job, job.text.slice(startLen)); }
        },
        onThinking: () => { if (!job.phase.startsWith("writing:")) job.phase = "thinking"; },
      });
      realModel = r.modelId;
      const out = job.text.slice(startLen);
      trackFiles(job, out);
      const files = S.parseFiles(out);
      if (!files["index.html"]) throw new Error(r.stop === "max_tokens" ? "The project was too large for one pass — try a simpler first version, then add features with edits" : "The build did not produce a valid index.html — please retry");
      if (job.stopped) throw { stopped: true };
      const final = await qa(job, files, project.title, lang, kind);
      if (job.stopped) throw { stopped: true };
      job.phase = "finishing";
      const version = await saveVersion(project.id, final.files, label);
      await updateMessage(msgId, {
        content: S.summaryOf(out) || "Your project is ready — have a look at the preview.",
        meta: {
          status: "done", files: Object.keys(final.files), duration: Date.now() - job.started, version,
          model: SHOWN_MODEL, notes: job.notes, verify: { fixed: final.fixed, remaining: final.remaining.map((x) => `${x.file}: ${x.problem}`), images: 0 },
        },
      });
      await touch(project.id, { stage: "ready" });
      job.status = "done";
      console.log(`[build] ${project.id} v${version} ${kind} via ${realModel} in ${((Date.now() - job.started) / 1000).toFixed(1)}s`);
      const title = (await getProject(project.id))?.title || project.title;
      await event(userId, "build_done", project.id, title, `v${version} is live${job.sources?.length ? " · used live web data" : ""}`);
      notify(userId, { title: `${title} is ready`, body: "Your build finished on Stak", tag: project.id, url: `./#/app/${project.id}` });
    } catch (e) {
      if (isStop(e, job)) { job.status = "stopped"; job.error = "Stopped"; await markStopped(project.id, msgId); return; }
      console.error("[build]", e.message);
      job.status = "error"; job.error = friendly(e);
      await updateMessage(msgId, { meta: { status: "error", error: job.error } });
      await event(userId, "job_failed", project.id, project.title, job.error);
      notify(userId, { title: `${project.title}: build failed`, body: job.error, tag: project.id, url: `./#/app/${project.id}` });
      const p = await getProject(project.id);
      await touch(project.id, { stage: Number(p?.version) > 0 ? "ready" : "error" });
    } finally { await finishJob(job); }
  });
  return job;
}

// verification + one repair round for files with real problems (skipped when short on time)
// local files referenced by the HTML pages (scripts, styles, other pages) that the build never wrote
const RUNTIME_FILES = new Set(["stak.js", "stak-ui.js", "stak-ui.css", "stak-motion.js"]);
function missingRefs(files) {
  const miss = new Set();
  for (const [name, src] of Object.entries(files)) {
    if (!name.endsWith(".html")) continue;
    const re = /<(?:script[^>]*\ssrc|link[^>]*\shref)=["']([^"'#?]+)["']/gi;
    let m;
    while ((m = re.exec(src))) {
      const ref = m[1].replace(/^\.\//, "");
      if (/^(https?:|\/\/|data:|\/api\/)/i.test(ref) || RUNTIME_FILES.has(ref)) continue;
      if (!/\.(js|css|mjs)$/i.test(ref)) continue;
      if (!files[ref]) miss.add(ref);
    }
  }
  return [...miss].slice(0, 4);
}
async function fillMissing(job, files, kind, lang) {
  const miss = missingRefs(files);
  if (!miss.length) return 0;
  job.phase = "repairing";
  const until = Math.min(job.deadline - 10e3, Date.now() + 110e3);
  const ctx = Object.entries(files).filter(([k]) => /\.(html|js|css)$/.test(k)).map(([k, v]) => `<stak-file path="${k}">\n${v.slice(0, k.endsWith(".css") ? 4000 : 24000)}\n</stak-file>`).join("\n");
  let n = 0;
  await Promise.all(miss.map(async (f) => {
    try {
      const text = await llm.complete(null, {
        role: "repair", kind, signal: job.ac.signal, deadline: until, system: P.BUILD_SYSTEM(lang, kind), maxTokens: 24000, temperature: 0.3, maxAttempts: 3,
        messages: [{ role: "user", content: `This project is missing the file "${f}" that index.html loads, so the app is broken. Write ONLY that file, complete, so that it works with the HTML ids/classes and other files below. Output exactly one <stak-file path="${f}"> block.\n\n${ctx}` }],
      });
      const out = S.parseFiles(text);
      if (out[f]) { files[f] = out[f]; n++; }
    } catch (e) { if (e.stopped) throw e; console.warn("[fill]", f, e.message); }
  }));
  if (n) job.notes = [...(job.notes || []), `Completed ${n} missing file${n > 1 ? "s" : ""}`];
  return n;
}

async function qa(job, files, title, lang, kind) {
  job.phase = "verifying";
  if (job.deadline - Date.now() > 40e3 && !job.stopped) await fillMissing(job, files, kind, lang);
  let v = await S.verifyFull(files, title);
  const bad = [...new Set(v.remaining.map((r) => r.file))].filter((f) => !!v.files[f]);
  const timeLeft = job.deadline - Date.now();
  if (bad.length && timeLeft > 70e3 && !job.stopped) {
    job.phase = "repairing";
    const until = Math.min(job.deadline - 15e3, Date.now() + 120e3);
    await Promise.all(bad.slice(0, 3).map(async (f) => {
      const problems = v.remaining.filter((r) => r.file === f).map((r) => "- " + r.problem).join("\n");
      try {
        const text = await llm.complete(null, {
          role: "repair", kind, signal: job.ac.signal, deadline: until, system: P.REPAIR_SYSTEM, maxTokens: 32000, temperature: 0.2, maxAttempts: 2,
          messages: [{ role: "user", content: `Other files in the project: ${Object.keys(v.files).join(", ")}\nProblems in ${f}:\n${problems}\n\n<stak-file path="${f}">\n${v.files[f]}\n</stak-file>` }],
        });
        const fixed = S.parseFiles(text);
        if (fixed[f]) v.files[f] = fixed[f];
      } catch (e) { if (e.stopped) throw e; console.warn("[repair]", e.message); }
    }));
    const before = v.fixed;
    const v2 = await S.verifyFull(v.files, title);
    v = { ...v2, fixed: before + v2.fixed + Math.max(0, v.remaining.length - v2.remaining.length) };
  }
  job.phase = "finishing";
  return v;
}

async function saveVersion(projectId, files, label) {
  files = S.withKit(files);
  const row = await db.get("SELECT MAX(n) AS m FROM versions WHERE project_id=?", projectId);
  const n = (Number(row?.m) || 0) + 1;
  await db.run("INSERT INTO versions(project_id,n,label,files,created) VALUES(?,?,?,?,?)", projectId, n, String(label).slice(0, 80), JSON.stringify(files), Date.now());
  await touch(projectId, { files: JSON.stringify(files), version: n });
  return n;
}

// ============ EDIT ============
async function startEdit({ project, userId, lang, msgId, text, selection, history }) {
  const job = await newJob("edit", project.id, userId);
  await updateMessage(msgId, { meta: { status: "running", started: job.started, phase: "thinking", model: SHOWN_MODEL } });
  await touch(project.id, { stage: "building" });
  const files = J(project.files, {});
  const kind = llm.classify(`${project.prompt}\n${text}`);
  schedule(async () => {
    try {
      let req = `CURRENT PROJECT FILES:\n${P.filesBlock(files)}`;
      if (history) req += `\nRECENT CONVERSATION:\n${history}\n`;
      if (selection?.selector) {
        req += `\nTHE USER SELECTED THIS ELEMENT in the preview (CSS path: ${selection.selector}${selection.label ? `, text: "${selection.label}"` : ""}):\n${String(selection.html || "").slice(0, 2400)}\nChange ONLY this element (and the CSS/JS it strictly needs) unless the request clearly says otherwise.\n`;
      }
      req += await webContext(job, text, []);
      if (job.stopped) throw { stopped: true };
      job.phase = "thinking";
      req += `\nUSER REQUEST:\n${text}`;
      const raw = { s: "" };
      let last = 0;
      let pump = makePump(job);
      await llm.stream(null, {
        role: "edit", kind, signal: job.ac.signal, deadline: job.deadline, system: P.EDIT_SYSTEM(lang), maxTokens: 32000, temperature: 0.3,
        messages: [{ role: "user", content: req }],
        onRestart: () => { raw.s = ""; job.text += "\n"; pump = makePump(job); job.doneFiles = []; },
        onText: (t) => {
          raw.s += t; pump(raw.s, false);
          const now = Date.now();
          if (now - last > 250) { last = now; trackFiles(job, job.text); }
        },
      });
      pump(raw.s, true); trackFiles(job, job.text);
      const out = raw.s;
      if (job.stopped) throw { stopped: true };
      const newFiles = { ...files, ...S.parseFiles(out) };
      const failed = [];
      for (const p of S.parsePatches(out)) {
        if (newFiles[p.path] === undefined) { failed.push(p); continue; }
        let src = newFiles[p.path], bad = 0;
        for (const b of p.blocks) { const r = S.applyBlock(src, b); if (r.ok) src = r.src; else bad++; }
        newFiles[p.path] = src;
        if (bad) failed.push(p);
      }
      // patches that didn't apply → ask for the whole updated file (in parallel)
      if (failed.length) job.phase = "repairing";
      await Promise.all(failed.slice(0, 2).map(async (p) => {
        try {
          const t = await llm.complete(null, {
            role: "repair", kind, signal: job.ac.signal, deadline: job.deadline, system: P.REPAIR_SYSTEM, maxTokens: 32000, temperature: 0.2,
            messages: [{ role: "user", content: `Apply this change request to the file and return the complete updated file.\nREQUEST: ${text}\n${selection?.selector ? `Selected element: ${selection.selector}\n` : ""}\n<stak-file path="${p.path}">\n${newFiles[p.path] || ""}\n</stak-file>` }],
          });
          const f = S.parseFiles(t);
          if (f[p.path]) newFiles[p.path] = f[p.path];
        } catch (e) { if (e.stopped) throw e; job.notes.push(`Couldn't fully apply the change to ${p.path}`); }
      }));
      if (job.stopped) throw { stopped: true };
      const summary = S.summaryOf(out);
      const changed = Object.keys(newFiles).filter((k) => newFiles[k] !== files[k]);
      if (!changed.length) {
        await updateMessage(msgId, { kind: "text", content: summary || "Done — nothing needed to change.", meta: { status: "done", model: SHOWN_MODEL } });
        await touch(project.id, { stage: "ready" });
        job.status = "done";
        return;
      }
      const final = await qa(job, newFiles, project.title, lang, kind);
      if (job.stopped) throw { stopped: true };
      job.phase = "finishing";
      const version = await saveVersion(project.id, final.files, text.slice(0, 80));
      await updateMessage(msgId, {
        content: summary || "Done — your change is live in the preview.",
        meta: {
          status: "done", files: changed, duration: Date.now() - job.started, version, model: SHOWN_MODEL, notes: job.notes,
          verify: { fixed: final.fixed, remaining: final.remaining.map((x) => `${x.file}: ${x.problem}`), images: 0 },
        },
      });
      await touch(project.id, { stage: "ready" });
      job.status = "done";
      await event(userId, "edit_done", project.id, project.title, `v${version}: ${text.slice(0, 120)}`);
      notify(userId, { title: `${project.title} updated`, body: "Your edit is ready on Stak", tag: project.id, url: `./#/app/${project.id}` });
    } catch (e) {
      if (isStop(e, job)) { job.status = "stopped"; job.error = "Stopped"; await markStopped(project.id, msgId); return; }
      console.error("[edit]", e.message);
      job.status = "error"; job.error = friendly(e);
      await updateMessage(msgId, { meta: { status: "error", error: job.error } });
      await event(userId, "job_failed", project.id, project.title, job.error);
      const p = await getProject(project.id);
      await touch(project.id, { stage: Number(p?.version) > 0 ? "ready" : "error" });
    } finally { await finishJob(job); }
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
  jobs, getJob, jobView, activeJobFor, activeJobsForUser, runningCount, stopJob, startQuestions, startBuild, startEdit, briefFrom,
  addMessage, getMessage, updateMessage, touch, getProject, resolveModel, event, setPush, saveVersion, normalizeQuestions, SHOWN_MODEL,
};

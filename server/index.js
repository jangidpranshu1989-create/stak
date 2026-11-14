// Stak backend — Express + Postgres/SQLite. Serves the prebuilt frontend (public/) and all /api routes.
// Runs as a normal Node server (`node server/index.js`) or as a Vercel Function (api/index.js imports `app`).
const path = require("path");
const express = require("express");
const JSZip = require("jszip");
const webpush = require("web-push");
const { db, encrypt, decrypt, hashPass, checkPass, rid, token, J, bump, used, kvGet, kvSet, ROOT } = require("./db");
const llm = require("./llm");
const S = require("./site");
const Jb = require("./jobs");
const IMG = require("./images");
const WEB = require("./search");
const CFG = require("./config");
const { safeUrl, safeFetch } = require("./netsafe");

const PORT = CFG.port;
const app = express();

// Express 4 does not catch rejected promises: wrap every async handler so errors reach the error middleware.
const wrapAsync = (f) => (typeof f === "function" && f.constructor.name === "AsyncFunction" ? (req, res, next) => f(req, res, next).catch(next) : f);
function patchRouter(r) {
  for (const m of ["get", "post", "put", "patch", "delete", "use", "all"]) {
    const orig = r[m].bind(r);
    r[m] = (...a) => (m === "get" && a.length === 1 ? orig(...a) : orig(...a.map(wrapAsync)));
  }
  return r;
}
patchRouter(app);

app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "6mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), microphone=(self)");
  if (!req.path.startsWith("/api/site/")) res.setHeader("X-Frame-Options", "SAMEORIGIN");
  // Generated sites share this origin: run them as an opaque origin so their scripts can never read Stak sessions or call /api/* as the user.
  else { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); }
  if (req.path.startsWith("/api/site/")) res.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads");
  next();
});
app.use("/api", async (req, res, next) => { await db.ready(); next(); });

// ------------------------------------------------------------------ helpers
const now = () => Date.now();
const ipOf = (req) => String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
const visitorOf = (req) => String(req.headers["x-visitor-id"] || "").slice(0, 120);
const bad = (res, code, message) => res.status(code).json({ message });
const pubUser = (u) => u && { id: u.id, name: u.name, email: Number(u.guest) ? null : u.email, guest: !!Number(u.guest), lang: u.lang || "en", created: Number(u.created) };
const cookieToken = (req) => { const m = String(req.headers.cookie || "").match(/(?:^|;\s*)(?:__Host-)?stak_token=([^;]+)/); return m ? decodeURIComponent(m[1]) : null; };
const isHttps = (req) => req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
const sessionCookie = (req, value, maxAge) => isHttps(req)
  ? `__Host-stak_token=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
  : `stak_token=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
const bearer = (req) => { const h = String(req.headers.authorization || ""); return h.startsWith("Bearer ") ? h.slice(7).trim() : null; };

async function sessionFrom(req) {
  const t = bearer(req) || cookieToken(req);
  const s = t ? await db.get("SELECT * FROM sessions WHERE token=?", t) : null;
  if (!s) return null;
  const u = await db.get("SELECT * FROM users WHERE id=?", s.user_id);
  if (u) u.guest = Number(u.guest);
  return u ? { s, u } : null;
}
async function auth(req, res, next) {
  const x = await sessionFrom(req);
  if (!x) return bad(res, 401, "Please sign in or continue as guest");
  req.user = x.u; req.sess = x.s; next();
}
async function newSession(res, req, user) {
  const t = token();
  await db.run("INSERT INTO sessions(token,user_id,visitor,created) VALUES(?,?,?,?)", t, user.id, visitorOf(req) || null, now());
  res.setHeader("Set-Cookie", sessionCookie(req, encodeURIComponent(t), 60 * 60 * 24 * 60));
  return t;
}

// ---- rate limiting: sliding minute window (memory, per instance) + daily caps (DB)
const windows = new Map();
function perMinute(key, max) {
  const t = now(), arr = (windows.get(key) || []).filter((x) => t - x < 60e3);
  if (arr.length >= max) { windows.set(key, arr); return false; }
  arr.push(t); windows.set(key, arr); return true;
}
setInterval(() => { const t = now(); for (const [k, a] of windows) if (!a.some((x) => t - x < 60e3)) windows.delete(k); }, 120e3).unref();

const LIMITS = {
  guest: { aiMin: 20, aiDay: 200, projDay: 40 },
  user: { aiMin: 20, aiDay: 400, projDay: 80 },
};
async function aiAllowed(req, res, { project = false } = {}) {
  const u = req.user, L = u.guest ? LIMITS.guest : LIMITS.user;
  if (!perMinute(`ai:${u.id}`, L.aiMin) || (u.guest && !perMinute(`aiip:${ipOf(req)}`, L.aiMin * 2))) {
    bad(res, 429, "You're going a bit fast — wait a few seconds and try again."); return false;
  }
  if ((await used(`ai:${u.id}`)) >= L.aiDay) {
    bad(res, 429, u.guest ? `Guest limit reached (${L.aiDay} builds and edits per day). Create a free account to keep building.` : "Daily limit reached — come back tomorrow."); return false;
  }
  if (project && (await used(`proj:${u.id}`)) >= L.projDay) {
    bad(res, 429, u.guest ? `Guests can start ${L.projDay} projects per day. Create a free account for more.` : "Daily project limit reached."); return false;
  }
  if (u.guest && (await used(`aiip:${ipOf(req)}`)) >= L.aiDay * 3) { bad(res, 429, "Daily guest limit reached on this network. Create a free account to continue."); return false; }
  await bump(`ai:${u.id}`); if (u.guest) await bump(`aiip:${ipOf(req)}`);
  if (project) await bump(`proj:${u.id}`);
  return true;
}

// ------------------------------------------------------------------ auth
app.post("/api/auth/guest", async (req, res) => {
  const key = `guest:${visitorOf(req) || ipOf(req)}`;
  if (!perMinute(key, 5) || (await bump(key)) > (Number(process.env.STAK_GUEST_DAY) || 12)) return bad(res, 429, "Too many guest sessions today — please create a free account.");
  const u = { id: rid(14), name: "Guest", guest: 1, lang: String(req.body?.lang || "en").slice(0, 12), created: now() };
  await db.run("INSERT INTO users(id,name,email,pass,guest,lang,created) VALUES(?,?,NULL,NULL,1,?,?)", u.id, u.name, u.lang, u.created);
  res.json({ token: await newSession(res, req, u), user: pubUser(u) });
});

app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password, lang } = req.body || {};
  const em = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return bad(res, 400, "Please enter a valid email");
  if (String(password || "").length < 6) return bad(res, 400, "Password must be at least 6 characters");
  if (!perMinute(`signup:${ipOf(req)}`, 5)) return bad(res, 429, "Too many attempts — try again in a minute");
  if (await db.get("SELECT 1 AS x FROM users WHERE email=?", em)) return bad(res, 409, "An account with this email already exists — sign in instead");
  const nm = String(name || "").trim().slice(0, 60) || em.split("@")[0];
  // upgrade the current guest in place so their projects are kept
  const cur = await sessionFrom(req);
  let u;
  if (cur && cur.u.guest) {
    await db.run("UPDATE users SET name=?, email=?, pass=?, guest=0, lang=COALESCE(?,lang) WHERE id=?", nm, em, hashPass(password), lang || null, cur.u.id);
    u = await db.get("SELECT * FROM users WHERE id=?", cur.u.id);
  } else {
    u = { id: rid(14), name: nm, email: em, guest: 0, lang: String(lang || "en").slice(0, 12), created: now() };
    await db.run("INSERT INTO users(id,name,email,pass,guest,lang,created) VALUES(?,?,?,?,0,?,?)", u.id, nm, em, hashPass(password), u.lang, u.created);
  }
  res.json({ token: await newSession(res, req, u), user: pubUser(u) });
});

app.post("/api/auth/login", async (req, res) => {
  const em = String(req.body?.email || "").trim().toLowerCase();
  if (!perMinute(`login:${ipOf(req)}`, 10) || !perMinute(`login:${em}`, 6)) return bad(res, 429, "Too many attempts — try again in a minute");
  const u = await db.get("SELECT * FROM users WHERE email=?", em);
  if (!u || !checkPass(req.body?.password || "", u.pass)) return bad(res, 401, "Wrong email or password");
  res.json({ token: await newSession(res, req, u), user: pubUser(u) });
});

app.post("/api/auth/logout", async (req, res) => {
  const t = bearer(req) || cookieToken(req);
  if (t) await db.run("DELETE FROM sessions WHERE token=?", t);
  if (visitorOf(req)) await db.run("DELETE FROM sessions WHERE visitor=?", visitorOf(req));
  res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  const x = await sessionFrom(req);
  if (!x) return bad(res, 401, "Not signed in");
  res.json({ user: pubUser(x.u), token: x.s.token });
});

app.patch("/api/me", auth, async (req, res) => {
  const { lang, name } = req.body || {};
  if (lang) await db.run("UPDATE users SET lang=? WHERE id=?", String(lang).slice(0, 12), req.user.id);
  if (name) await db.run("UPDATE users SET name=? WHERE id=?", String(name).slice(0, 60), req.user.id);
  res.json(pubUser(await db.get("SELECT * FROM users WHERE id=?", req.user.id)));
});

// ------------------------------------------------------------------ projects
const num = (x) => (x === null || x === undefined ? x : Number(x));
const msgView = (m) => ({ id: num(m.id), projectId: m.project_id, role: m.role, kind: m.kind, content: m.content, meta: stripMeta(J(m.meta, {})), created: num(m.created) });
function stripMeta(meta) { const { req, error, ...rest } = meta; void req; if (meta.status === "error") rest.error = error; return rest; }
async function projectView(p, full = true, runningSet = null) {
  const running = runningSet ? runningSet.has(p.id) : !!(await Jb.activeJobFor(p.id));
  const base = { id: p.id, title: p.title, prompt: p.prompt, lang: p.lang, stage: p.stage, version: num(p.version), created: num(p.created), updated: num(p.updated), running };
  return full ? { ...base, files: J(p.files, {}) } : base;
}
async function ownProject(req, res) {
  const p = await db.get("SELECT * FROM projects WHERE id=? AND user_id=?", req.params.id, req.user.id);
  if (!p) { bad(res, 404, "Project not found"); return null; }
  p.version = Number(p.version);
  return p;
}
const langOf = (req, p) => String(req.body?.lang || p?.lang || req.user?.lang || "en").slice(0, 12);

app.get("/api/projects", auth, async (req, res) => {
  const rows = await db.all("SELECT id,title,prompt,lang,stage,version,created,updated FROM projects WHERE user_id=? ORDER BY updated DESC LIMIT 300", req.user.id);
  const runningSet = new Set((await Jb.activeJobsForUser(req.user.id)).map((j) => j.projectId));
  res.json(await Promise.all(rows.map((p) => projectView(p, false, runningSet))));
});

app.post("/api/projects", auth, async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  if (prompt.length < 2) return bad(res, 400, "Tell me what you'd like to build");
  if (prompt.length > 6000) return bad(res, 400, "That's a bit long — keep it under 6000 characters");
  if (!(await aiAllowed(req, res, { project: true }))) return;
  const lang = langOf(req);
  const id = rid(10);
  const title = prompt.replace(/\s+/g, " ").slice(0, 48) + (prompt.length > 48 ? "…" : "");
  await db.run("INSERT INTO projects(id,user_id,title,prompt,lang,stage,version,files,created,updated) VALUES(?,?,?,?,?,'questions',0,'{}',?,?)", id, req.user.id, title, prompt, lang, now(), now());
  await Jb.addMessage(id, "user", "text", prompt, {});
  const msgId = await Jb.addMessage(id, "assistant", "questions", "", { status: "loading" });
  const p = await Jb.getProject(id);
  const job = await Jb.startQuestions({ project: p, userId: req.user.id, lang, msgId });
  res.json({ project: await projectView(p), jobId: job.id });
});

app.get("/api/projects/:id", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  const job = await Jb.activeJobFor(p.id); // also reaps a stale job first
  const messages = (await db.all("SELECT * FROM messages WHERE project_id=? ORDER BY id", p.id)).map(msgView);
  const versions = (await db.all("SELECT n,label,created FROM versions WHERE project_id=? ORDER BY n DESC", p.id)).map((v) => ({ n: num(v.n), label: v.label, created: num(v.created) }));
  const fresh = await db.get("SELECT * FROM projects WHERE id=?", p.id);
  res.json({ project: await projectView(fresh, true, new Set(job ? [p.id] : [])), messages, versions, activeJob: job ? job.id : null });
});

// rename (and other light updates)
app.patch("/api/projects/:id", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  const title = String(req.body?.title || "").trim().slice(0, 80);
  if (title) await Jb.touch(p.id, { title });
  res.json({ project: await projectView(await Jb.getProject(p.id)) });
});

app.delete("/api/projects/:id", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  const job = await Jb.activeJobFor(p.id);
  if (job) await Jb.stopJob(job);
  for (const t of ["messages", "versions", "secrets", "rt_users", "rt_sessions", "rt_docs", "rt_files", "assets", "jobs"]) await db.run(`DELETE FROM ${t} WHERE project_id=?`, p.id);
  await db.run("DELETE FROM projects WHERE id=?", p.id);
  res.json({ ok: true });
});

async function latestQuestions(pid) {
  const m = await db.get("SELECT * FROM messages WHERE project_id=? AND kind='questions' ORDER BY id DESC LIMIT 1", pid);
  if (m) m.meta = J(m.meta, {});
  return m;
}
async function saveSecrets(pid, secrets) {
  const saved = [];
  for (const [k, v] of Object.entries(secrets || {})) {
    const name = String(k).toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 60);
    const val = String(v || "").trim();
    if (!name || !val || val.length > 4000) continue;
    await db.run("INSERT INTO secrets(project_id,name,value,created) VALUES(?,?,?,?) ON CONFLICT(project_id,name) DO UPDATE SET value=excluded.value", pid, name, await encrypt(val), now());
    saved.push(name);
  }
  return saved;
}

app.post("/api/projects/:id/answers", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  if (await Jb.activeJobFor(p.id)) return bad(res, 409, "Stak is still working on this project");
  if (!(await aiAllowed(req, res))) return;
  const { answers = {}, notes = "", skip = false, secrets = {} } = req.body || {};
  const lang = langOf(req, p);
  const q = await latestQuestions(p.id);
  const questions = q?.meta?.questions || [];
  const saved = await saveSecrets(p.id, secrets);
  const clean = {};
  for (const qq of questions) {
    const a = answers[qq.id];
    if (!Array.isArray(a) || !a.length) continue;
    clean[qq.id] = a.map((x) => String(x).slice(0, 400)).slice(0, 10);
  }
  const notesS = String(notes || "").slice(0, 3000);
  let content;
  if (skip) content = "__skip__";
  else {
    const parts = questions.filter((qq) => qq.type !== "secret" && clean[qq.id]).map((qq) => `${qq.question}\n→ ${clean[qq.id].join(", ")}`);
    if (notesS.trim()) parts.push(`Notes\n→ ${notesS.trim()}`);
    if (saved.length) parts.push(`Keys\n→ ${saved.join(", ")} (encrypted)`);
    content = parts.join("\n\n") || "__skip__";
  }
  await Jb.addMessage(p.id, "user", "answers", content, { skipped: !!skip || content === "__skip__" });
  if (q) await Jb.updateMessage(q.id, { meta: { answered: true, answers: clean, saved } });
  await db.run("UPDATE projects SET answers=?, notes=? WHERE id=?", JSON.stringify(clean), notesS, p.id);
  const brief = Jb.briefFrom(p, { answers: clean, notes: notesS, skip: !!skip, questions });
  const msgId = await Jb.addMessage(p.id, "assistant", "build", "", { status: "running", req: { brief } });
  const job = await Jb.startBuild({ project: p, userId: req.user.id, lang, msgId, brief, label: "First build" });
  res.json({ jobId: job.id });
});

// photo uploads (for later edits). Body: {name, data: dataURL}
app.post("/api/projects/:id/uploads", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  if (!perMinute(`up:${req.user.id}`, req.user.guest ? 30 : 90)) return bad(res, 429, "Too many uploads — wait a few seconds");
  const r = await IMG.saveUpload(p.id, req.body?.name, req.body?.data);
  if (r.error) return bad(res, 400, r.error);
  res.json({ path: r.path, size: r.size, url: `/api/site/${p.id}/${r.path}` });
});
app.get("/api/projects/:id/assets", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  res.json((await IMG.listAssets(p.id)).map((a) => ({ path: a.path, kind: a.kind, url: `/api/site/${p.id}/${a.path}`, created: num(a.created) })));
});
app.delete("/api/projects/:id/assets", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  const fp = String(req.query.path || "");
  if (!fp.startsWith("assets/uploads/")) return bad(res, 400, "Only uploaded photos can be deleted");
  await db.run("DELETE FROM assets WHERE project_id=? AND path=?", p.id, fp);
  res.json({ ok: true });
});

async function historyOf(pid) {
  const rows = (await db.all("SELECT role,kind,content FROM messages WHERE project_id=? ORDER BY id DESC LIMIT 8", pid)).reverse();
  return rows.filter((r) => r.kind !== "questions" && r.content && r.content !== "__skip__").map((r) => `${r.role}: ${r.content.slice(0, 500)}`).join("\n");
}

app.post("/api/projects/:id/messages", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  const text = String(req.body?.text || "").trim();
  if (!text) return bad(res, 400, "Type a message first");
  if (text.length > 6000) return bad(res, 400, "Message too long");
  if (await Jb.activeJobFor(p.id)) return bad(res, 409, "Stak is still working — one moment, or press Stop");
  if (!(await aiAllowed(req, res))) return;
  const lang = langOf(req, p);
  const sel = req.body?.selection && typeof req.body.selection === "object" ? {
    selector: String(req.body.selection.selector || "").slice(0, 400), html: String(req.body.selection.html || "").slice(0, 2600), label: String(req.body.selection.label || "").slice(0, 80),
  } : null;
  await Jb.addMessage(p.id, "user", "text", text, { selection: sel?.selector || undefined, via: req.body?.via || "text" });
  if (p.version > 0 && J(p.files, {})["index.html"]) {
    const history = await historyOf(p.id);
    const msgId = await Jb.addMessage(p.id, "assistant", "edit", "", { status: "running", req: { text, selection: sel } });
    const job = await Jb.startEdit({ project: p, userId: req.user.id, lang, msgId, text, selection: sel, history });
    return res.json({ jobId: job.id });
  }
  // no site yet: treat the message as extra direction and build now
  const q = await latestQuestions(p.id);
  if (q && !q.meta.answered) await Jb.updateMessage(q.id, { meta: { superseded: true, answered: true } });
  const answers = J(p.answers, {});
  const brief = Jb.briefFrom(p, { answers, notes: [p.notes, text].filter(Boolean).join("\n"), skip: !Object.keys(answers).length, questions: q?.meta?.questions || [] });
  const msgId = await Jb.addMessage(p.id, "assistant", "build", "", { status: "running", req: { brief } });
  const job = await Jb.startBuild({ project: p, userId: req.user.id, lang, msgId, brief, label: "First build" });
  res.json({ jobId: job.id });
});

app.post("/api/projects/:id/retry", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  if (await Jb.activeJobFor(p.id)) return bad(res, 409, "Stak is still working — one moment");
  const last = await db.get("SELECT * FROM messages WHERE project_id=? AND role='assistant' AND kind IN ('questions','build','edit') ORDER BY id DESC LIMIT 1", p.id);
  if (!last) return bad(res, 400, "Nothing to retry");
  const meta = J(last.meta, {});
  if (meta.status !== "error") return bad(res, 400, "Nothing to retry");
  if (!(await aiAllowed(req, res))) return;
  const lang = langOf(req, p);
  let job;
  if (last.kind === "questions") {
    await Jb.updateMessage(last.id, { meta: { status: "loading", error: null } });
    job = await Jb.startQuestions({ project: p, userId: req.user.id, lang, msgId: last.id });
  } else if (last.kind === "build") {
    const brief = meta.req?.brief || Jb.briefFrom(p, { answers: J(p.answers, {}), notes: p.notes, skip: true, questions: [] });
    await Jb.updateMessage(last.id, { meta: { stopped: false } });
    job = await Jb.startBuild({ project: p, userId: req.user.id, lang, msgId: last.id, brief, label: "Rebuild" });
  } else {
    await Jb.updateMessage(last.id, { meta: { stopped: false } });
    job = await Jb.startEdit({ project: p, userId: req.user.id, lang, msgId: last.id, text: meta.req?.text || "Apply my last request", selection: meta.req?.selection, history: await historyOf(p.id) });
  }
  res.json({ jobId: job.id });
});

// Stop the running build/edit/questions job (works across instances; never deletes anything)
app.post("/api/projects/:id/stop", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  const job = await Jb.activeJobFor(p.id);
  if (!job) return res.json({ ok: true, stopped: false });
  await Jb.stopJob(job);
  res.json({ ok: true, stopped: true, jobId: job.id });
});
app.post("/api/jobs/:id/stop", auth, async (req, res) => {
  const job = await Jb.getJob(req.params.id);
  if (!job || job.userId !== req.user.id) return res.json({ ok: true, stopped: false });
  if (job.status === "running") await Jb.stopJob(job);
  res.json({ ok: true, stopped: true });
});

app.post("/api/projects/:id/restore", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  if (await Jb.activeJobFor(p.id)) return bad(res, 409, "Stak is still working — one moment");
  const n = Number(req.body?.n);
  const v = await db.get("SELECT * FROM versions WHERE project_id=? AND n=?", p.id, n);
  if (!v) return bad(res, 404, "Version not found");
  const nn = await Jb.saveVersion(p.id, J(v.files, {}), `Restored v${n}`);
  await Jb.touch(p.id, { stage: "ready" });
  await Jb.addMessage(p.id, "assistant", "text", `Restored **v${n}** — saved as v${nn}. Your newer versions are still in the history.`, {});
  res.json({ ok: true, version: nn });
});

app.get("/api/projects/:id/versions/:n", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  const v = await db.get("SELECT files FROM versions WHERE project_id=? AND n=?", p.id, Number(req.params.n));
  if (!v) return bad(res, 404, "Version not found");
  res.json(J(v.files, {}));
});

// ---- project secrets (owner)
const preview = (v) => (v.length <= 8 ? "•".repeat(v.length) : `${v.slice(0, 4)}…${v.slice(-4)}`);
const secretList = async (pid) => Promise.all((await db.all("SELECT name,value,created FROM secrets WHERE project_id=? ORDER BY name", pid)).map(async (s) => ({ name: s.name, preview: preview(await decrypt(s.value)), created: num(s.created) })));
app.get("/api/projects/:id/secrets", auth, async (req, res) => { const p = await ownProject(req, res); if (!p) return; res.json(await secretList(p.id)); });
app.put("/api/projects/:id/secrets", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  const name = String(req.body?.name || ""), value = String(req.body?.value || "");
  if (!/^[A-Z0-9_]{2,60}$/.test(name.toUpperCase()) || !value.trim()) return bad(res, 400, "Give the key a NAME and a value");
  await saveSecrets(p.id, { [name]: value });
  res.json(await secretList(p.id));
});
app.delete("/api/projects/:id/secrets/:name", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  await db.run("DELETE FROM secrets WHERE project_id=? AND name=?", p.id, req.params.name);
  res.json(await secretList(p.id));
});

// ---- Stak Cloud browser (owner)
const docView = (d) => ({ id: d.id, ...J(d.data, {}), owner: d.owner, created: num(d.created), updated: num(d.updated) });
app.get("/api/projects/:id/cloud", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  const collections = (await db.all("SELECT col AS name, COUNT(*) AS count FROM rt_docs WHERE project_id=? GROUP BY col ORDER BY count DESC", p.id)).map((c) => ({ name: c.name, count: num(c.count) }));
  const users = (await db.all("SELECT id,name,email,created FROM rt_users WHERE project_id=? ORDER BY created DESC LIMIT 200", p.id)).map((u) => ({ ...u, created: num(u.created) }));
  res.json({ collections, users });
});
app.get("/api/projects/:id/cloud/:table", auth, async (req, res) => {
  const p = await ownProject(req, res); if (!p) return;
  res.json((await db.all("SELECT * FROM rt_docs WHERE project_id=? AND col=? ORDER BY created DESC LIMIT 200", p.id, req.params.table)).map(docView));
});

// ------------------------------------------------------------------ jobs (polled every ~700 ms by the UI)
app.get("/api/jobs/:id", auth, async (req, res) => {
  const job = await Jb.getJob(req.params.id);
  if (!job || job.userId !== req.user.id) return res.json({ status: "gone" });
  res.setHeader("Cache-Control", "no-store");
  res.json(Jb.jobView(job, Math.max(0, Number(req.query.from) || 0)));
});

// ------------------------------------------------------------------ models (automatic only)
// The UI used to let people pick or add models. Stak now routes every request automatically.
app.get("/api/models", auth, async (req, res) => res.json({ builtin: llm.builtinList(), mine: [], providers: [], selected: "stak:auto", auto: true }));
app.put("/api/models/selected", auth, async (req, res) => res.json({ selected: "stak:auto" }));
app.post("/api/models/discover", auth, async (req, res) => bad(res, 400, "Not needed — Stak picks the best engine automatically."));
app.post("/api/models", auth, async (req, res) => bad(res, 400, "Not needed — Stak picks the best engine automatically."));
app.delete("/api/models/:id", auth, async (req, res) => res.json({ ok: true }));
app.post("/api/models/:id/test", auth, async (req, res) => res.json({ ok: true }));

// ------------------------------------------------------------------ push notifications (web push)
let vapidP = null;
function vapid() {
  if (!vapidP) vapidP = (async () => {
    let v = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY } : J(await kvGet("vapid"), null);
    if (!v) { v = webpush.generateVAPIDKeys(); await kvSet("vapid", JSON.stringify(v)); }
    webpush.setVapidDetails("mailto:hello@stak.app", v.publicKey, v.privateKey);
    return v;
  })().catch((e) => { vapidP = null; throw e; });
  return vapidP;
}
app.get("/api/push/key", async (req, res) => res.json({ key: (await vapid()).publicKey }));
app.post("/api/push/subscribe", auth, async (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint)) return bad(res, 400, "Invalid subscription");
  await db.run("INSERT INTO push_subs(endpoint,user_id,sub,created) VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, sub=excluded.sub", sub.endpoint, req.user.id, JSON.stringify(sub), now());
  res.json({ ok: true });
});
Jb.setPush(async (userId, payload) => {
  await vapid();
  for (const s of await db.all("SELECT * FROM push_subs WHERE user_id=?", userId)) {
    await webpush.sendNotification(J(s.sub, {}), JSON.stringify(payload), { TTL: 3600 }).catch(async (e) => {
      if (e.statusCode === 404 || e.statusCode === 410) await db.run("DELETE FROM push_subs WHERE endpoint=?", s.endpoint);
    });
  }
});

// ------------------------------------------------------------------ photos by keyword for generated sites
// <img src="/api/img?q=margherita+pizza&w=1200&h=800&n=1"> → 302 to a matching openly-licensed photo
app.get("/api/img", async (req, res) => {
  const w = Math.min(2000, Math.max(64, Number(req.query.w) || 1200)), h = Math.min(2000, Math.max(64, Number(req.query.h) || 800));
  const q = String(req.query.q || "").slice(0, 100);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  let url = null;
  try { url = await IMG.photoFor(q, w, h, Number(req.query.n) || 0); } catch {}
  if (url) { res.setHeader("Cache-Control", "public, max-age=86400"); return res.redirect(302, url); }
  res.setHeader("Cache-Control", "public, max-age=600");
  res.type("image/svg+xml").send(IMG.placeholderSvg(q, w, h));
});

// ------------------------------------------------------------------ generated sites (public by unguessable id)
async function siteFiles(id) {
  const p = await db.get("SELECT id,title,files FROM projects WHERE id=?", id);
  return p ? { p, files: J(p.files, {}) } : null;
}
async function sendAsset(res, pid, f) {
  if (!/^assets\/[\w\-./]+$/.test(f) || f.includes("..")) return false;
  const a = await IMG.getAsset(pid, f);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (a) {
    const data = Buffer.isBuffer(a.data) ? a.data : Buffer.from(a.data);
    const tag = `"${a.created}-${data.length}"`;
    res.setHeader("ETag", tag); res.setHeader("Cache-Control", "no-cache");
    if (res.req.headers["if-none-match"] === tag) { res.status(304).end(); return true; }
    res.type(a.mime).send(data); return true;
  }
  if (/^assets\/img\//.test(f)) { // legacy generated-image paths: soft placeholder
    res.setHeader("Cache-Control", "no-store");
    res.type("image/svg+xml").send(IMG.placeholderSvg(f)); return true;
  }
  return false;
}
app.get(/^\/api\/site\/([\w]+)(?:\/(.*))?$/, async (req, res) => {
  const x = await siteFiles(req.params[0]);
  if (!x) return res.status(404).type("text/plain").send("Site not found");
  let f = decodeURIComponent(req.params[1] || "index.html").replace(/^\/+/, "") || "index.html";
  if (f.endsWith("/")) f += "index.html";
  if (f.startsWith("assets/") && x.files[f] === undefined && (await sendAsset(res, x.p.id, f))) return;
  let body = x.files[f];
  if (body === undefined && S.RUNTIME[f]) body = S.RUNTIME[f];
  if (body === undefined && x.files[f + ".html"] !== undefined) { f += ".html"; body = x.files[f]; }
  if (body === undefined) return res.status(404).type("text/plain").send("Not found");
  res.setHeader("Cache-Control", "no-cache");
  if (/\.html?$/i.test(f)) body = S.withShim(String(body));
  res.type(S.mimeOf(f)).send(body);
});

function originOf(req) { return CFG.publicUrl || `${isHttps(req) ? "https" : "http"}://${req.headers["x-forwarded-host"] || req.headers.host}`; }
async function exportFiles(id, api, origin) {
  const x = await siteFiles(id);
  if (!x) return null;
  const out = { ...x.files };
  const all = Object.values(out).join("\n");
  if (all.includes("stak.js")) out["stak.js"] = S.RUNTIME["stak.js"];
  if (all.includes("stak-motion.js")) out["stak-motion.js"] = S.RUNTIME["stak-motion.js"];
  const apiOk = /^https?:\/\/[^\s"'<>]+$/.test(api || "") ? api : origin;
  for (const k of Object.keys(out)) {
    if (/\.(html?|css|js)$/.test(k)) out[k] = String(out[k]).replace(/(["'(])\/api\/img\?/g, `$1${origin}/api/img?`);
    if (/\.html?$/.test(k)) out[k] = S.withConfig(out[k], id, apiOk);
  }
  return { ...x, out };
}
app.get("/api/dl/:id/site.zip", async (req, res) => {
  const x = await exportFiles(req.params.id, String(req.query.api || ""), originOf(req));
  if (!x) return bad(res, 404, "Not found");
  const zip = new JSZip();
  for (const [k, v] of Object.entries(x.out)) zip.file(k, v);
  for (const a of await IMG.listAssets(x.p.id)) { const row = await IMG.getAsset(x.p.id, a.path); if (row) zip.file(a.path, Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data)); }
  zip.file("README.txt", `${x.p.title}\n\nBuilt with Stak. Open index.html, or upload this folder to any static host (Netlify, Vercel, GitHub Pages).\nLogin and database features keep working through Stak Cloud.\n`);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const name = (x.p.title || "site").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "site";
  res.setHeader("Content-Disposition", `attachment; filename="${name}.zip"`);
  res.type("application/zip").send(buf);
});
app.get("/api/dl/:id/file/:name", async (req, res) => {
  const x = await exportFiles(req.params.id, String(req.query.api || ""), originOf(req));
  const f = req.params.name;
  if (!x || x.out[f] === undefined) return bad(res, 404, "Not found");
  res.setHeader("Content-Disposition", `attachment; filename="${f.replace(/[^\w.\-]/g, "_")}"`);
  res.type(S.mimeOf(f)).send(x.out[f]);
});
app.get("/api/thumb/:id/:v", (req, res) => res.status(404).end());

// ------------------------------------------------------------------ Stak Cloud runtime for generated apps
const rt = patchRouter(express.Router({ mergeParams: true }));
app.use("/api/rt/:pid", async (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  const p = await db.get("SELECT id,user_id,title FROM projects WHERE id=?", req.params.pid);
  if (!p) return bad(res, 404, "App not found");
  req.project = p;
  const t = bearer(req);
  if (t) {
    const s = await db.get("SELECT * FROM rt_sessions WHERE token=? AND project_id=?", t, p.id);
    if (s) req.rtUser = (await db.get("SELECT * FROM rt_users WHERE id=?", s.user_id)) || null;
  }
  const writes = req.method !== "GET";
  if (!perMinute(`rt:${p.id}:${ipOf(req)}`, writes ? 90 : 240)) return bad(res, 429, "Too many requests — slow down a little");
  next();
}, rt);

const rtUserView = (u) => u && { id: u.id, name: u.name, email: u.email, created: num(u.created), ...J(u.data, {}) };
rt.get("/", (req, res) => res.json({ ok: true, project: req.project.id, name: req.project.title }));
rt.get(/^\/assets\/(.+)$/, async (req, res) => { if (!(await sendAsset(res, req.project.id, "assets/" + req.params[0]))) bad(res, 404, "Not found"); });
rt.post("/auth/signup", async (req, res) => {
  const { name, email, password } = req.body || {};
  const em = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return bad(res, 400, "Please enter a valid email");
  if (String(password || "").length < 6) return bad(res, 400, "Password must be at least 6 characters");
  if (await db.get("SELECT 1 AS x FROM rt_users WHERE project_id=? AND email=?", req.project.id, em)) return bad(res, 409, "An account with this email already exists");
  if (Number((await db.get("SELECT COUNT(*) AS c FROM rt_users WHERE project_id=?", req.project.id)).c) > 5000) return bad(res, 403, "This app has reached its user limit");
  const u = { id: "u_" + rid(12), name: String(name || em.split("@")[0]).slice(0, 80), email: em, created: now() };
  await db.run("INSERT INTO rt_users(id,project_id,name,email,pass,data,created) VALUES(?,?,?,?,?,'{}',?)", u.id, req.project.id, u.name, em, hashPass(password), u.created);
  const t = token();
  await db.run("INSERT INTO rt_sessions(token,project_id,user_id,created) VALUES(?,?,?,?)", t, req.project.id, u.id, now());
  res.json({ token: t, user: rtUserView(u) });
});
rt.post("/auth/login", async (req, res) => {
  const em = String(req.body?.email || "").trim().toLowerCase();
  if (!perMinute(`rtlogin:${req.project.id}:${em}`, 6)) return bad(res, 429, "Too many attempts — try again in a minute");
  const u = await db.get("SELECT * FROM rt_users WHERE project_id=? AND email=?", req.project.id, em);
  if (!u || !checkPass(req.body?.password || "", u.pass)) return bad(res, 401, "Wrong email or password");
  const t = token();
  await db.run("INSERT INTO rt_sessions(token,project_id,user_id,created) VALUES(?,?,?,?)", t, req.project.id, u.id, now());
  res.json({ token: t, user: rtUserView(u) });
});
rt.post("/auth/logout", async (req, res) => { const t = bearer(req); if (t) await db.run("DELETE FROM rt_sessions WHERE token=?", t); res.json({ ok: true }); });
rt.get("/auth/me", (req, res) => res.json({ user: rtUserView(req.rtUser) || null }));
rt.patch("/auth/me", async (req, res) => {
  if (!req.rtUser) return bad(res, 401, "Please sign in");
  const { name, email, password, id, created, ...extra } = req.body || {};
  void email; void password; void id; void created;
  const data = { ...J(req.rtUser.data, {}), ...extra };
  if (JSON.stringify(data).length > 20000) return bad(res, 413, "Profile too large");
  await db.run("UPDATE rt_users SET name=COALESCE(?,name), data=? WHERE id=?", name ? String(name).slice(0, 80) : null, JSON.stringify(data), req.rtUser.id);
  res.json({ user: rtUserView(await db.get("SELECT * FROM rt_users WHERE id=?", req.rtUser.id)) });
});

// database
const colOk = (c) => /^[\w-]{1,48}$/.test(c);
const RESERVED = ["id", "owner", "created", "updated"];
const cleanDoc = (b) => { const o = {}; for (const [k, v] of Object.entries(b && typeof b === "object" && !Array.isArray(b) ? b : {})) if (!RESERVED.includes(k)) o[k] = v; return o; };
rt.get("/db/:col", async (req, res) => {
  const col = req.params.col; if (!colOk(col)) return bad(res, 400, "Bad collection name");
  if (req.query.mine && !req.rtUser) return bad(res, 401, "Please sign in");
  let rows = (await db.all(`SELECT * FROM rt_docs WHERE project_id=? AND col=? ${req.query.mine ? "AND owner=?" : ""} ORDER BY created DESC LIMIT 5000`,
    ...[req.project.id, col, ...(req.query.mine ? [req.rtUser.id] : [])])).map(docView);
  const where = J(req.query.where, null);
  if (where && typeof where === "object") rows = rows.filter((d) => Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(d[k]) : d[k] === v)));
  if (req.query.q) { const q = String(req.query.q).toLowerCase(); rows = rows.filter((d) => JSON.stringify(d).toLowerCase().includes(q)); }
  const sort = String(req.query.sort || "-created");
  const desc = sort.startsWith("-"), key = sort.replace(/^[-+]/, "");
  rows.sort((a, b) => { const x = a[key], y = b[key]; if (x === y) return 0; if (x === undefined) return 1; if (y === undefined) return -1; return (x > y ? 1 : -1) * (desc ? -1 : 1); });
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  res.json(rows.slice(0, limit));
});
rt.get("/db/:col/:id", async (req, res) => {
  const d = await db.get("SELECT * FROM rt_docs WHERE id=? AND project_id=? AND col=?", req.params.id, req.project.id, req.params.col);
  if (!d) return bad(res, 404, "Not found");
  res.json(docView(d));
});
rt.post("/db/:col", async (req, res) => {
  const col = req.params.col; if (!colOk(col)) return bad(res, 400, "Bad collection name");
  const data = cleanDoc(req.body);
  const s = JSON.stringify(data);
  if (s.length > 200000) return bad(res, 413, "That item is too large");
  if (Number((await db.get("SELECT COUNT(*) AS c FROM rt_docs WHERE project_id=?", req.project.id)).c) >= 50000) return bad(res, 403, "This app has reached its storage limit");
  const d = { id: rid(14), project_id: req.project.id, col, owner: req.rtUser?.id || null, data: s, created: now(), updated: now() };
  await db.run("INSERT INTO rt_docs(id,project_id,col,owner,data,created,updated) VALUES(?,?,?,?,?,?,?)", d.id, d.project_id, col, d.owner, s, d.created, d.updated);
  res.json(docView(d));
});
async function editableDoc(req, res) {
  const d = await db.get("SELECT * FROM rt_docs WHERE id=? AND project_id=? AND col=?", req.params.id, req.project.id, req.params.col);
  if (!d) { bad(res, 404, "Not found"); return null; }
  if (d.owner && d.owner !== req.rtUser?.id) { bad(res, 403, "Only the person who created this can change it"); return null; }
  return d;
}
rt.patch("/db/:col/:id", async (req, res) => {
  const d = await editableDoc(req, res); if (!d) return;
  const s = JSON.stringify({ ...J(d.data, {}), ...cleanDoc(req.body) });
  if (s.length > 200000) return bad(res, 413, "That item is too large");
  await db.run("UPDATE rt_docs SET data=?, updated=? WHERE id=?", s, now(), d.id);
  res.json(docView(await db.get("SELECT * FROM rt_docs WHERE id=?", d.id)));
});
rt.put("/db/:col/:id", async (req, res) => {
  const d = await editableDoc(req, res); if (!d) return;
  await db.run("UPDATE rt_docs SET data=?, updated=? WHERE id=?", JSON.stringify(cleanDoc(req.body)), now(), d.id);
  res.json(docView(await db.get("SELECT * FROM rt_docs WHERE id=?", d.id)));
});
rt.delete("/db/:col/:id", async (req, res) => {
  const d = await editableDoc(req, res); if (!d) return;
  await db.run("DELETE FROM rt_docs WHERE id=?", d.id);
  res.json({ ok: true, id: d.id });
});

// smart chat for generated apps (e.g. a chatbot the user built). Billed to the Stak server; capped.
rt.post("/ai/chat", async (req, res) => {
  const pid = req.project.id;
  if (!perMinute(`rtai:${ipOf(req)}`, 12) || !perMinute(`rtai:${pid}`, 40)) return bad(res, 429, "Busy — try again in a few seconds");
  if ((await bump(`rtai:${pid}`)) > 400) return bad(res, 429, "This app reached its daily chat limit");
  const { messages, system, temperature, maxTokens, stream } = req.body || {};
  const msgs = (Array.isArray(messages) ? messages : []).filter((m) => m && m.content).slice(-30).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 12000) }));
  while (msgs.length && msgs[0].role === "assistant") msgs.shift();
  if (!msgs.length) return bad(res, 400, "Send at least one message");
  const opts = { role: "fast", system: String(system || "You are a helpful assistant inside a web app. Be concise.").slice(0, 8000), messages: msgs, maxTokens: Math.min(4000, Number(maxTokens) || 1200), temperature: Math.min(1, Math.max(0, Number(temperature ?? 0.7))), deadline: Date.now() + 60e3 };
  try {
    if (stream) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");
      await llm.stream(null, { ...opts, onText: (t) => res.write(t) });
      return res.end();
    }
    res.json({ text: await llm.complete(null, opts) });
  } catch {
    if (res.headersSent) return res.end();
    bad(res, 502, "Request failed — please try again");
  }
});

// real-time web search for generated apps (stak.web.search / stak.web.answer)
rt.post("/web/search", async (req, res) => {
  const pid = req.project.id;
  if (!perMinute(`rtweb:${ipOf(req)}`, 10) || (await bump(`rtweb:${pid}`)) > 500) return bad(res, 429, "Search limit reached — try again later");
  const q = String(req.body?.q || "").trim().slice(0, 300);
  if (!q) return bad(res, 400, "Send a search query");
  try { res.json({ results: await WEB.search(q, { limit: Math.min(10, Number(req.body?.limit) || 6) }) }); }
  catch { bad(res, 502, "Search failed — please try again"); }
});
rt.post("/web/answer", async (req, res) => {
  const pid = req.project.id;
  if (!perMinute(`rtweb:${ipOf(req)}`, 6) || (await bump(`rtwebai:${pid}`)) > 200) return bad(res, 429, "Search limit reached — try again later");
  const q = String(req.body?.q || "").trim().slice(0, 400);
  if (!q) return bad(res, 400, "Send a question");
  try {
    const r = await WEB.research({ topic: q, queries: [q], llm, mode: "answer" });
    if (!r) return bad(res, 502, "No results found");
    res.json({ answer: r.summary, sources: r.sources });
  } catch { bad(res, 502, "Search failed — please try again"); }
});

// external API proxy with secret substitution
rt.get("/secrets", async (req, res) => res.json({ names: (await db.all("SELECT name FROM secrets WHERE project_id=?", req.project.id)).map((r) => r.name) }));
const hostCache = new Map();
async function fetchHosts(pid) {
  const v = await db.get("SELECT n,files FROM versions WHERE project_id=? ORDER BY n DESC LIMIT 1", pid);
  const key = `${pid}:${v?.n || 0}`;
  if (hostCache.has(key)) return hostCache.get(key);
  const set = new Set();
  const text = v ? String(v.files) : "";
  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) set.add(m[1].toLowerCase());
  const extra = await db.get("SELECT value FROM secrets WHERE project_id=? AND name='STAK_FETCH_HOSTS'", pid);
  if (extra) for (const x of String(await decrypt(extra.value)).split(/[,\s]+/)) if (x) set.add(x.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
  if (hostCache.size > 500) hostCache.clear();
  hostCache.set(key, set);
  return set;
}
rt.post("/fetch", async (req, res) => {
  const pid = req.project.id;
  if ((await bump(`rtfetch:${pid}`)) > 2000) return bad(res, 429, "This app reached its daily API limit");
  const sec = Object.fromEntries(await Promise.all((await db.all("SELECT name,value FROM secrets WHERE project_id=?", pid)).map(async (r) => [r.name, await decrypt(r.value)])));
  const missing = new Set();
  const sub = (s) => String(s).replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_, n) => { if (sec[n] === undefined) { missing.add(n); return ""; } return sec[n]; });
  const { url, method = "GET", headers = {}, body } = req.body || {};
  const finalUrl = sub(url || "");
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) if (!/^(host|cookie|content-length)$/i.test(k)) h[k] = sub(v);
  const b = body === undefined || body === null ? undefined : sub(typeof body === "string" ? body : JSON.stringify(body));
  if (b && !Object.keys(h).some((k) => k.toLowerCase() === "content-type") && typeof body === "object") h["Content-Type"] = "application/json";
  if (missing.size) return bad(res, 428, `Add the ${[...missing].join(", ")} key in Stak Cloud → Keys to use this feature`);
  const u = await safeUrl(finalUrl);
  if (!u) return bad(res, 400, "That URL isn't allowed");
  // Secrets are only ever sent to hosts the project's own code calls (or STAK_FETCH_HOSTS), so a visitor can't exfiltrate them.
  const usesSecret = /\{\{\s*[A-Z0-9_]+\s*\}\}/.test(JSON.stringify([url, headers, body]));
  if (usesSecret && !(await fetchHosts(pid)).has(u.hostname.toLowerCase())) return bad(res, 403, `Keys can only be sent to API hosts used in this app's code (or listed in the STAK_FETCH_HOSTS key). ${u.hostname} isn't one of them.`);
  try {
    const r = await safeFetch(u.toString(), { method: String(method).toUpperCase(), headers: h, body: /^(GET|HEAD)$/i.test(method) ? undefined : b, signal: AbortSignal.timeout(20000) });
    const buf = Buffer.from(await r.arrayBuffer());
    let text = buf.subarray(0, 2_000_000).toString("utf8");
    for (const v of Object.values(sec)) if (v && v.length > 5) text = text.split(v).join("[secret]");
    res.json({ ok: r.ok, status: r.status, text });
  } catch (e) { bad(res, 502, `Request failed: ${e.message}`); }
});

// uploads
rt.post("/files", async (req, res) => {
  const { name, type, data } = req.body || {};
  const m = String(data || "").match(/^data:([^;,]*)(;base64)?,(.*)$/s);
  if (!m) return bad(res, 400, "Send the file as a data URL");
  const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
  if (buf.length > 4 * 1024 * 1024) return bad(res, 413, "Files can be up to 4 MB");
  if ((await bump(`rtfiles:${req.project.id}`, 1)) > 500) return bad(res, 429, "Daily upload limit reached");
  const id = rid(16);
  const t = String(type || m[1] || "application/octet-stream").slice(0, 100);
  await db.run("INSERT INTO rt_files(id,project_id,name,type,data,created) VALUES(?,?,?,?,?,?)", id, req.project.id, String(name || "file").slice(0, 120), t, buf, now());
  res.json({ id, path: `/files/${id}`, name: String(name || "file"), type: t, size: buf.length });
});
rt.get("/files/:fid", async (req, res) => {
  const f = await db.get("SELECT * FROM rt_files WHERE id=? AND project_id=?", req.params.fid, req.project.id);
  if (!f) return res.status(404).end();
  const safe = /^(image\/(png|jpe?g|gif|webp|avif)|video\/|audio\/|application\/pdf|text\/plain)/.test(f.type) ? f.type : "application/octet-stream";
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.type(safe).send(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data));
});
rt.use((req, res) => bad(res, 404, "Unknown Stak Cloud endpoint"));

// ------------------------------------------------------------------ health / status
const BOOT = now();
app.get("/api/health", async (req, res) => res.json({ ok: true, uptime: Math.round((now() - BOOT) / 1000), version: require("../package.json").version, db: require("./db").DIALECT, providers: Object.keys(CFG.providers) }));
app.get("/api/status", async (req, res) => {
  const s = llm.status();
  res.json({ providers: Object.keys(s.providers), engines: s.models.length, healthy: s.models.filter((m) => m.ok !== false).length, search: WEB.providers(), jobs: { running: await Jb.runningCount(), max: CFG.maxJobs } });
});
// detailed engine health (owner/debug) — protected by STAK_ADMIN_TOKEN
app.get("/api/admin/engines", async (req, res) => {
  if (!process.env.STAK_ADMIN_TOKEN || bearer(req) !== process.env.STAK_ADMIN_TOKEN) return bad(res, 403, "Forbidden");
  if (req.query.probe) await llm.refreshHealth();
  res.json(llm.status());
});

// ------------------------------------------------------------------ mobile app (Android widgets + notifications)
const PHASE_PROGRESS = { thinking: 0.12, researching: 0.08, planning: 0.1, verifying: 0.85, repairing: 0.88, finishing: 0.95, done: 1 };
function progressOf(j) {
  if (j.status !== "running") return 1;
  const ph = String(j.phase || "");
  if (ph.startsWith("writing:")) return Math.min(0.78, 0.2 + j.doneFiles.length * 0.12);
  return PHASE_PROGRESS[ph] ?? 0.15;
}
app.get("/api/mobile/summary", auth, async (req, res) => {
  const u = req.user, L = u.guest ? LIMITS.guest : LIMITS.user;
  const projects = await db.all("SELECT id,title,stage,version,updated FROM projects WHERE user_id=? ORDER BY updated DESC", u.id);
  const titles = Object.fromEntries(projects.map((p) => [p.id, p.title]));
  const active = (await Jb.activeJobsForUser(u.id)).map((j) => ({
    jobId: j.id, projectId: j.projectId, title: titles[j.projectId] || "Project", type: j.type, phase: j.phase,
    elapsed: Math.round((now() - j.started) / 1000), progress: Math.round(progressOf(j) * 100) / 100, model: Jb.SHOWN_MODEL,
  }));
  const pending = [];
  for (const p of projects.filter((x) => x.stage === "questions").slice(0, 10)) {
    const q = await latestQuestions(p.id);
    if (q && !q.meta.answered && q.meta.status === "ready") pending.push({ projectId: p.id, title: p.title, count: (q.meta.questions || []).length });
  }
  const runningIds = new Set(active.map((a) => a.projectId));
  const recent = projects.slice(0, 8).map((p) => ({ id: p.id, title: p.title, stage: p.stage, running: runningIds.has(p.id), updated: num(p.updated), version: num(p.version), url: Number(p.version) ? `/api/site/${p.id}/` : null, thumb: null }));
  res.json({
    user: { id: u.id, name: u.name, guest: !!u.guest },
    stats: { projects: projects.length, building: active.length, ready: projects.filter((p) => p.stage === "ready").length, needsAnswers: pending.length },
    usage: { aiUsed: await used(`ai:${u.id}`), aiLimit: L.aiDay },
    active, pending, recent, serverTime: now(),
  });
});
app.get("/api/mobile/events", auth, async (req, res) => {
  const after = Math.max(0, Number(req.query.after) || 0);
  const rows = after
    ? await db.all("SELECT * FROM events WHERE user_id=? AND id>? ORDER BY id LIMIT 50", req.user.id, after)
    : (await db.all("SELECT * FROM events WHERE user_id=? ORDER BY id DESC LIMIT 20", req.user.id)).reverse();
  const last = rows.length ? Number(rows[rows.length - 1].id) : (Number((await db.get("SELECT MAX(id) AS m FROM events WHERE user_id=?", req.user.id))?.m) || after);
  res.json({ events: rows.map((e) => ({ id: num(e.id), type: e.type, projectId: e.project_id, title: e.title, body: e.body, created: num(e.created) })), last });
});
// Android app download info
app.get("/api/mobile/app", (req, res) => res.json({ apk: CFG.apkUrl, version: require("../package.json").version }));

// ------------------------------------------------------------------ web search for the builder UI (signed-in)
app.post("/api/search", auth, async (req, res) => {
  if (!perMinute(`search:${req.user.id}`, 10)) return bad(res, 429, "Too many searches — wait a moment");
  try { res.json({ results: await WEB.search(String(req.body?.q || ""), { limit: 8 }) }); } catch { bad(res, 502, "Search failed"); }
});

app.use("/api", (req, res) => bad(res, 404, "Not found"));
// static frontend (on Vercel the CDN serves public/ directly; this is for local / Docker runs)
app.use(express.static(path.join(ROOT, "public"), {
  index: "index.html",
  setHeaders: (res, fp) => res.setHeader("Cache-Control", /[\\/]assets[\\/]/.test(fp) ? "public, max-age=31536000, immutable" : "no-cache"),
}));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(ROOT, "public", "index.html")));
app.use((err, req, res, next) => {
  void next;
  console.error("[error]", req.method, req.path, err?.stack || err);
  if (err?.type === "entity.too.large") return bad(res, 413, "Request too large");
  if (res.headersSent) return res.end();
  bad(res, 500, "Something went wrong on our side — please retry");
});

if (require.main === module) {
  db.ready().then(() => {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Stak v4 on :${PORT} · db: ${require("./db").DIALECT} · providers: ${Object.keys(CFG.providers).join(", ") || "none"}`);
      llm.refreshHealth().catch(() => {});
    });
    setInterval(() => llm.refreshHealth().catch(() => {}), 10 * 60e3).unref();
    for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => {
      console.log(`[${sig}] shutting down`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 8000).unref();
    });
  }).catch((e) => { console.error("DB init failed:", e); process.exit(1); });
}

module.exports = app;

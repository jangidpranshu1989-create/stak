// Stak backend — Express + SQLite. Serves the prebuilt frontend (public/) and all /api routes.
const path = require("path");
const express = require("express");
const JSZip = require("jszip");
const webpush = require("web-push");
const dns = require("dns").promises;
const net = require("net");
const { db, encrypt, decrypt, hashPass, checkPass, rid, token, J, bump, used, kvGet, kvSet, ROOT } = require("./db");
const llm = require("./llm");
const S = require("./site");
const Jb = require("./jobs");
const IMG = require("./images");
const { runProbe } = require("./probe");
const WEB = require("./search");
const CFG = require("./config");

const PORT = Number(process.env.PORT || 5000);
const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "9mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(self), microphone=(self)");
  if (!req.path.startsWith("/api/site/")) res.setHeader("X-Frame-Options", "SAMEORIGIN");
  // Generated sites share this origin: run them as an opaque origin so their scripts can never read Stak sessions or call /api/* as the user.
  else { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); }
  if (req.path.startsWith("/api/site/")) res.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads");
  next();
});

// ------------------------------------------------------------------ helpers
const now = () => Date.now();
const ipOf = (req) => String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
const visitorOf = (req) => String(req.headers["x-visitor-id"] || "").slice(0, 120);
const bad = (res, code, message) => res.status(code).json({ message });
const pubUser = (u) => u && { id: u.id, name: u.name, email: u.guest ? null : u.email, guest: !!u.guest, lang: u.lang || "en", created: u.created };
// pplx.app (and other shared hosts) only forward "__Host-" cookies; use that name on HTTPS, plain name on http://localhost
const cookieToken = (req) => { const m = String(req.headers.cookie || "").match(/(?:^|;\s*)(?:__Host-)?stak_token=([^;]+)/); return m ? decodeURIComponent(m[1]) : null; };
const isHttps = (req) => req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
const sessionCookie = (req, value, maxAge) => isHttps(req)
  ? `__Host-stak_token=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
  : `stak_token=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
const bearer = (req) => { const h = String(req.headers.authorization || ""); return h.startsWith("Bearer ") ? h.slice(7).trim() : null; };

function sessionFrom(req, allowVisitor = false) {
  let t = bearer(req) || cookieToken(req);
  let s = t ? db.prepare("SELECT * FROM sessions WHERE token=?").get(t) : null;
  if (!s) return null;
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(s.user_id);
  return u ? { s, u } : null;
}
function auth(req, res, next) {
  const x = sessionFrom(req);
  if (!x) return bad(res, 401, "Please sign in or continue as guest");
  req.user = x.u; req.sess = x.s; next();
}
function newSession(res, req, user) {
  const t = token();
  db.prepare("INSERT INTO sessions(token,user_id,visitor,created) VALUES(?,?,?,?)").run(t, user.id, visitorOf(req) || null, now());
  res.setHeader("Set-Cookie", sessionCookie(req, encodeURIComponent(t), 60 * 60 * 24 * 60));
  return t;
}

// ---- rate limiting: sliding minute window (memory) + daily caps (SQLite)
const windows = new Map();
function perMinute(key, max) {
  const t = now(), arr = (windows.get(key) || []).filter((x) => t - x < 60e3);
  if (arr.length >= max) { windows.set(key, arr); return false; }
  arr.push(t); windows.set(key, arr); return true;
}
setInterval(() => { const t = now(); for (const [k, a] of windows) if (!a.some((x) => t - x < 60e3)) windows.delete(k); }, 120e3).unref();

const LIMITS = {
  guest: { aiMin: 60, aiDay: 1000, projDay: 100, modelDay: 100 },
  user: { aiMin: 10, aiDay: 150, projDay: 60, modelDay: 30 },
};
function aiAllowed(req, res, { project = false } = {}) {
  const u = req.user, L = u.guest ? LIMITS.guest : LIMITS.user;
  if (!perMinute(`ai:${u.id}`, L.aiMin) || (u.guest && !perMinute(`aiip:${ipOf(req)}`, L.aiMin * 2))) {
    bad(res, 429, "You're going a bit fast — wait a few seconds and try again."); return false;
  }
  if (used(`ai:${u.id}`) >= L.aiDay) {
    bad(res, 429, u.guest ? `Guest limit reached (${L.aiDay} AI actions/day). Create a free account to keep building.` : "Daily limit reached — come back tomorrow."); return false;
  }
  if (project && used(`proj:${u.id}`) >= L.projDay) {
    bad(res, 429, u.guest ? `Guests can start ${L.projDay} projects per day. Create a free account for more.` : "Daily project limit reached."); return false;
  }
  if (u.guest && used(`aiip:${ipOf(req)}`) >= L.aiDay * 3) { bad(res, 429, "Daily guest limit reached on this network. Create a free account to continue."); return false; }
  bump(`ai:${u.id}`); if (u.guest) bump(`aiip:${ipOf(req)}`);
  if (project) bump(`proj:${u.id}`);
  return true;
}

// ------------------------------------------------------------------ auth
app.post("/api/auth/guest", (req, res) => {
  const key = `guest:${visitorOf(req) || ipOf(req)}`;
  if (!perMinute(key, 5) || bump(key) > 8) return bad(res, 429, "Too many guest sessions today — please create a free account.");
  const u = { id: rid(14), name: "Guest", guest: 1, lang: String(req.body?.lang || "en").slice(0, 12), created: now() };
  db.prepare("INSERT INTO users(id,name,email,pass,guest,lang,created) VALUES(?,?,NULL,NULL,1,?,?)").run(u.id, u.name, u.lang, u.created);
  res.json({ token: newSession(res, req, u), user: pubUser(u) });
});

app.post("/api/auth/signup", (req, res) => {
  const { name, email, password, lang } = req.body || {};
  const em = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return bad(res, 400, "Please enter a valid email");
  if (String(password || "").length < 6) return bad(res, 400, "Password must be at least 6 characters");
  if (!perMinute(`signup:${ipOf(req)}`, 5)) return bad(res, 429, "Too many attempts — try again in a minute");
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(em)) return bad(res, 409, "An account with this email already exists — sign in instead");
  const nm = String(name || "").trim().slice(0, 60) || em.split("@")[0];
  // upgrade the current guest in place so their projects are kept
  const cur = sessionFrom(req);
  let u;
  if (cur && cur.u.guest) {
    db.prepare("UPDATE users SET name=?, email=?, pass=?, guest=0, lang=COALESCE(?,lang) WHERE id=?").run(nm, em, hashPass(password), lang || null, cur.u.id);
    u = db.prepare("SELECT * FROM users WHERE id=?").get(cur.u.id);
  } else {
    u = { id: rid(14), name: nm, email: em, guest: 0, lang: String(lang || "en").slice(0, 12), created: now() };
    db.prepare("INSERT INTO users(id,name,email,pass,guest,lang,created) VALUES(?,?,?,?,0,?,?)").run(u.id, nm, em, hashPass(password), u.lang, u.created);
  }
  res.json({ token: newSession(res, req, u), user: pubUser(u) });
});

app.post("/api/auth/login", (req, res) => {
  const em = String(req.body?.email || "").trim().toLowerCase();
  if (!perMinute(`login:${ipOf(req)}`, 10) || !perMinute(`login:${em}`, 6)) return bad(res, 429, "Too many attempts — try again in a minute");
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(em);
  if (!u || !checkPass(req.body?.password || "", u.pass)) return bad(res, 401, "Wrong email or password");
  res.json({ token: newSession(res, req, u), user: pubUser(u) });
});

app.post("/api/auth/logout", (req, res) => {
  const t = bearer(req) || cookieToken(req);
  if (t) db.prepare("DELETE FROM sessions WHERE token=?").run(t);
  if (visitorOf(req)) db.prepare("DELETE FROM sessions WHERE visitor=?").run(visitorOf(req));
  res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const x = sessionFrom(req, true);
  if (!x) return bad(res, 401, "Not signed in");
  res.json({ user: pubUser(x.u), token: x.s.token });
});

app.patch("/api/me", auth, (req, res) => {
  const { lang, name } = req.body || {};
  if (lang) db.prepare("UPDATE users SET lang=? WHERE id=?").run(String(lang).slice(0, 12), req.user.id);
  if (name) db.prepare("UPDATE users SET name=? WHERE id=?").run(String(name).slice(0, 60), req.user.id);
  res.json(pubUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id)));
});

// ------------------------------------------------------------------ projects
const msgView = (m) => ({ id: m.id, projectId: m.project_id, role: m.role, kind: m.kind, content: m.content, meta: stripMeta(J(m.meta, {})), created: m.created });
function stripMeta(meta) { const { req, error, ...rest } = meta; return rest; }
function projectView(p, full = true) {
  const running = !!Jb.activeJobFor(p.id);
  const base = { id: p.id, title: p.title, prompt: p.prompt, lang: p.lang, stage: p.stage, version: p.version, created: p.created, updated: p.updated, running };
  return full ? { ...base, files: J(p.files, {}) } : base;
}
function ownProject(req, res) {
  const p = db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!p) { bad(res, 404, "Project not found"); return null; }
  return p;
}
const wantedModel = (req) => String(req.headers["x-stak-model"] || req.user?.selected_model || "stak:pro");
const langOf = (req, p) => String(req.body?.lang || p?.lang || req.user?.lang || "en").slice(0, 12);

app.get("/api/projects", auth, (req, res) => {
  const rows = db.prepare("SELECT id,title,prompt,lang,stage,version,created,updated FROM projects WHERE user_id=? ORDER BY updated DESC LIMIT 300").all(req.user.id);
  res.json(rows.map((p) => projectView(p, false)));
});

app.post("/api/projects", auth, (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  if (prompt.length < 2) return bad(res, 400, "Tell me what you'd like to build");
  if (prompt.length > 6000) return bad(res, 400, "That's a bit long — keep it under 6000 characters");
  if (!aiAllowed(req, res, { project: true })) return;
  const lang = langOf(req);
  const id = rid(10);
  const title = prompt.replace(/\s+/g, " ").slice(0, 48) + (prompt.length > 48 ? "…" : "");
  db.prepare("INSERT INTO projects(id,user_id,title,prompt,lang,stage,version,files,created,updated) VALUES(?,?,?,?,?,'questions',0,'{}',?,?)")
    .run(id, req.user.id, title, prompt, lang, now(), now());
  Jb.addMessage(id, "user", "text", prompt, {});
  const msgId = Jb.addMessage(id, "assistant", "questions", "", { status: "loading" });
  const p = Jb.getProject(id);
  const job = Jb.startQuestions({ project: p, userId: req.user.id, lang, wanted: wantedModel(req), msgId });
  res.json({ project: projectView(Jb.getProject(id)), jobId: job.id });
});

app.get("/api/projects/:id", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const messages = db.prepare("SELECT * FROM messages WHERE project_id=? ORDER BY id").all(p.id).map(msgView);
  const versions = db.prepare("SELECT n,label,created FROM versions WHERE project_id=? ORDER BY n DESC").all(p.id);
  const job = Jb.activeJobFor(p.id);
  res.json({ project: projectView(p), messages, versions, activeJob: job ? job.id : null });
});

app.patch("/api/projects/:id", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const title = String(req.body?.title || "").trim().slice(0, 80);
  if (title) Jb.touch(p.id, { title });
  res.json({ project: projectView(Jb.getProject(p.id)) });
});

app.delete("/api/projects/:id", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  for (const t of ["messages", "versions", "secrets"]) db.prepare(`DELETE FROM ${t} WHERE project_id=?`).run(p.id);
  for (const t of ["rt_users", "rt_sessions", "rt_docs", "rt_files", "assets"]) db.prepare(`DELETE FROM ${t} WHERE project_id=?`).run(p.id);
  db.prepare("DELETE FROM projects WHERE id=?").run(p.id);
  res.json({ ok: true });
});

function latestQuestions(pid) {
  const m = db.prepare("SELECT * FROM messages WHERE project_id=? AND kind='questions' ORDER BY id DESC LIMIT 1").get(pid);
  if (m) m.meta = J(m.meta, {});
  return m;
}
function saveSecrets(pid, secrets) {
  const saved = [];
  for (const [k, v] of Object.entries(secrets || {})) {
    const name = String(k).toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 60);
    const val = String(v || "").trim();
    if (!name || !val || val.length > 4000) continue;
    db.prepare("INSERT INTO secrets(project_id,name,value,created) VALUES(?,?,?,?) ON CONFLICT(project_id,name) DO UPDATE SET value=excluded.value")
      .run(pid, name, encrypt(val), now());
    saved.push(name);
  }
  return saved;
}

app.post("/api/projects/:id/answers", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  if (Jb.activeJobFor(p.id)) return bad(res, 409, "Stak is still working on this project");
  if (!aiAllowed(req, res)) return;
  const { answers = {}, notes = "", skip = false, secrets = {} } = req.body || {};
  const lang = langOf(req, p);
  const q = latestQuestions(p.id);
  const questions = q?.meta?.questions || [];
  const saved = saveSecrets(p.id, secrets);
  const clean = {};
  for (const qq of questions) {
    const a = answers[qq.id];
    if (!Array.isArray(a) || !a.length) continue;
    if (qq.type === "images") {
      // keep the chosen label + only uploads that really belong to this project
      const ups = a.map(String).filter((v) => v.startsWith("upload:assets/uploads/") && IMG.getAsset(p.id, v.slice(7))).slice(0, qq.max || 20);
      const label = a.map(String).find((v) => !v.startsWith("upload:")) || (ups.length ? qq.options?.[0] : qq.options?.[1]) || "";
      clean[qq.id] = [label.slice(0, 120), ...(ups.length ? ups : ["upload:ai"])];
    } else clean[qq.id] = a.map((x) => String(x).slice(0, 400)).slice(0, 10);
  }
  const notesS = String(notes || "").slice(0, 3000);
  let content;
  if (skip) content = "__skip__";
  else {
    const shown = (qq) => {
      if (qq.type !== "images") return clean[qq.id].join(", ");
      const n = clean[qq.id].filter((v) => v.startsWith("upload:assets/")).length;
      const label = clean[qq.id][0].replace(/\s*\(\d+\)$/, "");
      return n ? `${label} · ${n} photo${n > 1 ? "s" : ""} ✓` : label;
    };
    const parts = questions.filter((qq) => qq.type !== "secret" && clean[qq.id]).map((qq) => `${qq.question}\n→ ${shown(qq)}`);
    if (notesS.trim()) parts.push(`Notes\n→ ${notesS.trim()}`);
    if (saved.length) parts.push(`Keys\n→ ${saved.join(", ")} (encrypted)`);
    content = parts.join("\n\n") || "__skip__";
  }
  Jb.addMessage(p.id, "user", "answers", content, { skipped: !!skip || content === "__skip__" });
  if (q) Jb.updateMessage(q.id, { meta: { answered: true, answers: clean, saved } });
  db.prepare("UPDATE projects SET answers=?, notes=? WHERE id=?").run(JSON.stringify(clean), notesS, p.id);
  const brief = Jb.briefFrom(p, { answers: clean, notes: notesS, skip: !!skip, questions });
  const msgId = Jb.addMessage(p.id, "assistant", "build", "", { status: "running", req: { brief } });
  const job = Jb.startBuild({ project: p, userId: req.user.id, lang, wanted: wantedModel(req), msgId, brief, label: "First build" });
  res.json({ jobId: job.id });
});

// photo uploads for "images" questions (and later edits). Body: {name, data: dataURL}
app.post("/api/projects/:id/uploads", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  if (!perMinute(`up:${req.user.id}`, req.user.guest ? 30 : 90)) return bad(res, 429, "Too many uploads — wait a few seconds");
  const r = IMG.saveUpload(p.id, req.body?.name, req.body?.data);
  if (r.error) return bad(res, 400, r.error);
  res.json({ path: r.path, size: r.size, url: `/api/site/${p.id}/${r.path}` });
});
app.get("/api/projects/:id/assets", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  res.json(IMG.listAssets(p.id).map((a) => ({ path: a.path, kind: a.kind, size: a.size, url: `/api/site/${p.id}/${a.path}`, created: a.created })));
});
app.delete("/api/projects/:id/assets", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const path = String(req.query.path || "");
  if (!path.startsWith("assets/uploads/")) return bad(res, 400, "Only uploaded photos can be deleted");
  db.prepare("DELETE FROM assets WHERE project_id=? AND path=?").run(p.id, path);
  res.json({ ok: true });
});

function historyOf(pid) {
  const rows = db.prepare("SELECT role,kind,content FROM messages WHERE project_id=? ORDER BY id DESC LIMIT 8").all(pid).reverse();
  return rows.filter((r) => r.kind !== "questions" && r.content && r.content !== "__skip__").map((r) => `${r.role}: ${r.content.slice(0, 500)}`).join("\n");
}

app.post("/api/projects/:id/messages", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const text = String(req.body?.text || "").trim();
  if (!text) return bad(res, 400, "Type a message first");
  if (text.length > 6000) return bad(res, 400, "Message too long");
  if (Jb.activeJobFor(p.id)) return bad(res, 409, "Stak is still working — one moment");
  if (!aiAllowed(req, res)) return;
  const lang = langOf(req, p);
  const sel = req.body?.selection && typeof req.body.selection === "object" ? {
    selector: String(req.body.selection.selector || "").slice(0, 400), html: String(req.body.selection.html || "").slice(0, 2600), label: String(req.body.selection.label || "").slice(0, 80),
  } : null;
  Jb.addMessage(p.id, "user", "text", text, { selection: sel?.selector || undefined, via: req.body?.via || "text" });
  if (p.version > 0 && J(p.files, {})["index.html"]) {
    const history = historyOf(p.id);
    const msgId = Jb.addMessage(p.id, "assistant", "edit", "", { status: "running", req: { text, selection: sel } });
    const job = Jb.startEdit({ project: p, userId: req.user.id, lang, wanted: wantedModel(req), msgId, text, selection: sel, history });
    return res.json({ jobId: job.id });
  }
  // no site yet: treat the message as extra direction and build now
  const q = latestQuestions(p.id);
  if (q && !q.meta.answered) Jb.updateMessage(q.id, { meta: { superseded: true, answered: true } });
  const answers = J(p.answers, {});
  const brief = Jb.briefFrom(p, { answers, notes: [p.notes, text].filter(Boolean).join("\n"), skip: !Object.keys(answers).length, questions: q?.meta?.questions || [] });
  const msgId = Jb.addMessage(p.id, "assistant", "build", "", { status: "running", req: { brief } });
  const job = Jb.startBuild({ project: p, userId: req.user.id, lang, wanted: wantedModel(req), msgId, brief, label: "First build" });
  res.json({ jobId: job.id });
});

app.post("/api/projects/:id/retry", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  if (Jb.activeJobFor(p.id)) return bad(res, 409, "Stak is still working — one moment");
  const last = db.prepare("SELECT * FROM messages WHERE project_id=? AND role='assistant' AND kind IN ('questions','build','edit') ORDER BY id DESC LIMIT 1").get(p.id);
  if (!last) return bad(res, 400, "Nothing to retry");
  const meta = J(last.meta, {});
  if (meta.status !== "error") return bad(res, 400, "Nothing to retry");
  if (!aiAllowed(req, res)) return;
  const lang = langOf(req, p);
  let job;
  if (last.kind === "questions") {
    Jb.updateMessage(last.id, { meta: { status: "loading", error: null } });
    job = Jb.startQuestions({ project: p, userId: req.user.id, lang, wanted: wantedModel(req), msgId: last.id });
  } else if (last.kind === "build") {
    const brief = meta.req?.brief || Jb.briefFrom(p, { answers: J(p.answers, {}), notes: p.notes, skip: true, questions: [] });
    job = Jb.startBuild({ project: p, userId: req.user.id, lang, wanted: wantedModel(req), msgId: last.id, brief, label: "Rebuild" });
  } else {
    job = Jb.startEdit({ project: p, userId: req.user.id, lang, wanted: wantedModel(req), msgId: last.id, text: meta.req?.text || "Apply my last request", selection: meta.req?.selection, history: historyOf(p.id) });
  }
  res.json({ jobId: job.id });
});

app.post("/api/projects/:id/restore", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  if (Jb.activeJobFor(p.id)) return bad(res, 409, "Stak is still working — one moment");
  const n = Number(req.body?.n);
  const v = db.prepare("SELECT * FROM versions WHERE project_id=? AND n=?").get(p.id, n);
  if (!v) return bad(res, 404, "Version not found");
  const nn = Jb.saveVersion(p.id, J(v.files, {}), `Restored v${n}`);
  Jb.touch(p.id, { stage: "ready" });
  Jb.addMessage(p.id, "assistant", "text", `Restored **v${n}** — saved as v${nn}. Your newer versions are still in the history.`, {});
  res.json({ ok: true, version: nn });
});

app.get("/api/projects/:id/versions/:n", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const v = db.prepare("SELECT files FROM versions WHERE project_id=? AND n=?").get(p.id, Number(req.params.n));
  if (!v) return bad(res, 404, "Version not found");
  res.json(J(v.files, {}));
});

// ---- project secrets (owner)
const preview = (v) => (v.length <= 8 ? "•".repeat(v.length) : `${v.slice(0, 4)}…${v.slice(-4)}`);
const secretList = (pid) => db.prepare("SELECT name,value,created FROM secrets WHERE project_id=? ORDER BY name").all(pid).map((s) => ({ name: s.name, preview: preview(decrypt(s.value)), created: s.created }));
app.get("/api/projects/:id/secrets", auth, (req, res) => { const p = ownProject(req, res); if (!p) return; res.json(secretList(p.id)); });
app.put("/api/projects/:id/secrets", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const name = String(req.body?.name || ""), value = String(req.body?.value || "");
  if (!/^[A-Z0-9_]{2,60}$/.test(name.toUpperCase()) || !value.trim()) return bad(res, 400, "Give the key a NAME and a value");
  saveSecrets(p.id, { [name]: value });
  res.json(secretList(p.id));
});
app.delete("/api/projects/:id/secrets/:name", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  db.prepare("DELETE FROM secrets WHERE project_id=? AND name=?").run(p.id, req.params.name);
  res.json(secretList(p.id));
});

// ---- Stak Cloud browser (owner)
const docView = (d) => ({ id: d.id, ...J(d.data, {}), owner: d.owner, created: d.created, updated: d.updated });
app.get("/api/projects/:id/cloud", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const collections = db.prepare("SELECT col AS name, COUNT(*) AS count FROM rt_docs WHERE project_id=? GROUP BY col ORDER BY count DESC").all(p.id);
  const users = db.prepare("SELECT id,name,email,created FROM rt_users WHERE project_id=? ORDER BY created DESC LIMIT 200").all(p.id);
  res.json({ collections, users });
});
app.get("/api/projects/:id/cloud/:table", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  res.json(db.prepare("SELECT * FROM rt_docs WHERE project_id=? AND col=? ORDER BY created DESC LIMIT 200").all(p.id, req.params.table).map(docView));
});

// ------------------------------------------------------------------ jobs
app.get("/api/jobs/:id", auth, (req, res) => {
  const job = Jb.jobs.get(req.params.id);
  if (!job || job.userId !== req.user.id) return res.json({ status: "gone" });
  res.json(Jb.jobView(job, Math.max(0, Number(req.query.from) || 0)));
});

app.post("/api/projects/:id/stop", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const job = Jb.activeJobFor(p.id);
  if (!job) return res.json({ ok: true, message: "No active job" });
  if (job.userId !== req.user.id) return bad(res, 403, "Not your job");
  job.status = "stopped";
  job.error = "Stopped by user";
  Jb.jobs.delete(job.id);
  res.json({ ok: true, message: "Job stopped" });
});

// ------------------------------------------------------------------ models
const PROVIDERS = [
  {
    id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", keyPrefix: "gsk_", help: "https://console.groq.com/keys",
    models: [
      { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B (best · web search)" },
      { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B" },
      { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B (fastest)" },
    ],
  },
  {
    id: "nvidia", name: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", keyPrefix: "nvapi-", help: "https://build.nvidia.com/settings/api-keys",
    models: [
      { id: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra 550B" },
      { id: "mistralai/mistral-large-4-1t-a52b", name: "Mistral Large 4" },
      { id: "minimaxai/minimax-m3.1-flash", name: "MiniMax M3.1 Flash" },
      { id: "deepseek-ai/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
      { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" },
      { id: "poolside/laguna-xs-2.1", name: "Poolside Laguna XS 2.1" },
      { id: "google/gemma-4-31b-it", name: "Gemma 4 31B" },
    ],
  },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyPrefix: "sk-or-", help: "https://openrouter.ai/keys", models: [] },
  { id: "together", name: "Together AI", baseUrl: "https://api.together.xyz/v1", keyPrefix: "", help: "https://api.together.ai/settings/api-keys", models: [] },
  { id: "openai", name: "Any OpenAI-compatible", baseUrl: "", keyPrefix: "", help: "", models: [] },
];
const providerOf = (id) => PROVIDERS.find((p) => p.id === id);

const { safeUrl, safeFetch } = require("./netsafe");
function baseFor(provider, baseUrl) {
  const pv = providerOf(provider);
  if (!pv) return null;
  if (pv.id !== "openai") return pv.baseUrl;
  const b = String(baseUrl || "").trim().replace(/\/+$/, "");
  return /^https:\/\//.test(b) ? b : null;
}
function modelView(r) {
  return { id: r.id, name: r.name, provider: r.provider, providerName: r.provider_name, model: r.model, status: r.status, step: r.step || "", result: J(r.result, {}), created: r.created };
}

app.get("/api/models", auth, (req, res) => {
  const mine = db.prepare("SELECT * FROM models WHERE user_id=? ORDER BY created").all(req.user.id).map(modelView);
  res.json({
    builtin: llm.builtinList(),
    mine, providers: PROVIDERS.map(({ baseUrl, ...p }) => ({ ...p, baseUrl })), selected: req.user.selected_model || "stak:pro",
  });
});

app.post("/api/models/discover", auth, async (req, res) => {
  const { provider, baseUrl, apiKey } = req.body || {};
  const base = baseFor(provider, baseUrl);
  if (!base) return bad(res, 400, "Enter an https:// base URL");
  if (!apiKey) return bad(res, 400, "Paste your API key first");
  if (!perMinute(`disc:${req.user.id}`, 8)) return bad(res, 429, "Slow down a little");
  if (!(await safeUrl(base))) return bad(res, 400, "That URL isn't allowed");
  try {
    const r = await safeFetch(base + "/models", { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    if (!r.ok) return bad(res, 400, `Provider said ${r.status}: ${t.slice(0, 160)}`);
    const j = J(t, {});
    const list = (Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : []).map((m) => m.id || m.name).filter(Boolean)
      .filter((id) => !/embed|whisper|tts|audio|guard|rerank|moderation|image|dall-e|vision-only|transcri/i.test(id)).slice(0, 200);
    res.json({ models: list });
  } catch (e) { bad(res, 400, `Couldn't reach the provider: ${e.message}`); }
});

app.post("/api/models", auth, async (req, res) => {
  const { provider, apiKey, baseUrl, models } = req.body || {};
  const pv = providerOf(provider);
  const base = baseFor(provider, baseUrl);
  if (!pv || !base) return bad(res, 400, "Pick a provider (custom providers need an https:// base URL)");
  if (!apiKey || String(apiKey).trim().length < 8) return bad(res, 400, "Paste a valid API key");
  if (!Array.isArray(models) || !models.length) return bad(res, 400, "Pick at least one model");
  if (!(await safeUrl(base))) return bad(res, 400, "That URL isn't allowed");
  const L = req.user.guest ? LIMITS.guest : LIMITS.user;
  if (used(`model:${req.user.id}`) + models.length > L.modelDay) return bad(res, 429, req.user.guest ? "Guests can test a few models per day — create a free account for more." : "Daily model-test limit reached.");
  bump(`model:${req.user.id}`, models.length);
  const enc = encrypt(String(apiKey).trim());
  const ids = [];
  for (const m of models.slice(0, 8)) {
    const mid = String(m.id || "").trim().slice(0, 160);
    if (!mid) continue;
    const id = "m_" + rid(10);
    db.prepare("INSERT INTO models(id,user_id,provider,provider_name,base_url,api_key,model,name,status,step,result,created) VALUES(?,?,?,?,?,?,?,?,'testing','queued','{}',?)")
      .run(id, req.user.id, pv.id, pv.name, base, enc, mid, String(m.name || mid.split("/").pop()).slice(0, 60), now());
    ids.push(id);
  }
  // test sequentially to stay under provider rate limits
  (async () => { for (const id of ids) await runProbe(id).catch((e) => console.error("[probe]", e)); })();
  res.json({ ids });
});

app.delete("/api/models/:id", auth, (req, res) => {
  db.prepare("DELETE FROM models WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  if (req.user.selected_model === req.params.id) db.prepare("UPDATE users SET selected_model='stak:pro' WHERE id=?").run(req.user.id);
  res.json({ ok: true });
});
app.post("/api/models/:id/test", auth, (req, res) => {
  const r = db.prepare("SELECT id FROM models WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!r) return bad(res, 404, "Model not found");
  if (!perMinute(`retest:${req.user.id}`, 4)) return bad(res, 429, "Slow down a little");
  db.prepare("UPDATE models SET status='testing', step='queued' WHERE id=?").run(r.id);
  runProbe(r.id).catch(() => {});
  res.json({ ok: true });
});
app.put("/api/models/selected", auth, (req, res) => {
  const id = String(req.body?.id || "stak:pro");
  const ok = llm.builtin(id) || db.prepare("SELECT 1 FROM models WHERE id=? AND user_id=?").get(id, req.user.id);
  db.prepare("UPDATE users SET selected_model=? WHERE id=?").run(ok ? id : "stak:pro", req.user.id);
  res.json({ selected: ok ? id : "stak:pro" });
});

// ------------------------------------------------------------------ push
let vapid = J(kvGet("vapid"), null);
if (!vapid) { vapid = webpush.generateVAPIDKeys(); kvSet("vapid", JSON.stringify(vapid)); }
webpush.setVapidDetails("mailto:hello@stak.app", vapid.publicKey, vapid.privateKey);
app.get("/api/push/key", (req, res) => res.json({ key: vapid.publicKey }));
app.post("/api/push/subscribe", auth, (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint)) return bad(res, 400, "Invalid subscription");
  db.prepare("INSERT INTO push_subs(endpoint,user_id,sub,created) VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, sub=excluded.sub")
    .run(sub.endpoint, req.user.id, JSON.stringify(sub), now());
  res.json({ ok: true });
});
Jb.setPush((userId, payload) => {
  for (const s of db.prepare("SELECT * FROM push_subs WHERE user_id=?").all(userId)) {
    webpush.sendNotification(J(s.sub, {}), JSON.stringify(payload), { TTL: 3600 }).catch((e) => {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare("DELETE FROM push_subs WHERE endpoint=?").run(s.endpoint);
    });
  }
});

// ------------------------------------------------------------------ generated sites (public by unguessable id)
function siteFiles(id) {
  const p = db.prepare("SELECT id,title,files FROM projects WHERE id=?").get(id);
  return p ? { p, files: J(p.files, {}) } : null;
}
function sendAsset(res, pid, f) {
  if (!/^assets\/[\w\-./]+$/.test(f) || f.includes("..")) return false;
  const a = IMG.getAsset(pid, f);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (a) {
    const tag = `"${a.created}-${a.data.length}"`;
    res.setHeader("ETag", tag); res.setHeader("Cache-Control", "no-cache");
    if (res.req.headers["if-none-match"] === tag) { res.status(304).end(); return true; }
    res.type(a.mime).send(a.data); return true;
  }
  if (/^assets\/img\//.test(f)) { // AI image not generated (yet): soft placeholder
    res.setHeader("Cache-Control", "no-store");
    res.type("image/svg+xml").send(IMG.placeholderSvg(f)); return true;
  }
  return false;
}
app.get(/^\/api\/site\/([\w]+)(?:\/(.*))?$/, (req, res) => {
  const x = siteFiles(req.params[0]);
  if (!x) return res.status(404).type("text/plain").send("Site not found");
  let f = decodeURIComponent(req.params[1] || "index.html").replace(/^\/+/, "") || "index.html";
  if (f.endsWith("/")) f += "index.html";
  if (f.startsWith("assets/") && x.files[f] === undefined && sendAsset(res, x.p.id, f)) return;
  let body = x.files[f];
  if (body === undefined && S.RUNTIME[f]) body = S.RUNTIME[f];
  if (body === undefined && x.files[f + ".html"] !== undefined) { f += ".html"; body = x.files[f]; }
  if (body === undefined) return res.status(404).type("text/plain").send("Not found");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (/\.html?$/i.test(f)) body = S.withShim(String(body));
  res.type(S.mimeOf(f)).send(body);
});

function exportFiles(id, api) {
  const x = siteFiles(id);
  if (!x) return null;
  const out = { ...x.files };
  const all = Object.values(out).join("\n");
  if (all.includes("stak.js")) out["stak.js"] = S.RUNTIME["stak.js"];
  if (all.includes("stak-motion.js")) out["stak-motion.js"] = S.RUNTIME["stak-motion.js"];
  const apiOk = /^https?:\/\/[^\s"'<>]+$/.test(api || "") ? api : "";
  for (const k of Object.keys(out)) if (/\.html?$/.test(k)) out[k] = S.withConfig(out[k], id, apiOk);
  return { ...x, out };
}
app.get("/api/dl/:id/site.zip", async (req, res) => {
  const x = exportFiles(req.params.id, String(req.query.api || ""));
  if (!x) return bad(res, 404, "Not found");
  const zip = new JSZip();
  for (const [k, v] of Object.entries(x.out)) zip.file(k, v);
  for (const a of IMG.listAssets(x.p.id)) { const row = IMG.getAsset(x.p.id, a.path); if (row) zip.file(a.path, row.data); }
  zip.file("README.txt", `${x.p.title}\n\nBuilt with Stak. Open index.html, or upload this folder to any static host (Netlify, Vercel, GitHub Pages).\nLogin, database and AI keep working through Stak Cloud.\n`);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const name = (x.p.title || "site").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "site";
  res.setHeader("Content-Disposition", `attachment; filename="${name}.zip"`);
  res.type("application/zip").send(buf);
});
app.get("/api/dl/:id/file/:name", (req, res) => {
  const x = exportFiles(req.params.id, String(req.query.api || ""));
  const f = req.params.name;
  if (!x || x.out[f] === undefined) return bad(res, 404, "Not found");
  res.setHeader("Content-Disposition", `attachment; filename="${f.replace(/[^\w.\-]/g, "_")}"`);
  res.type(S.mimeOf(f)).send(x.out[f]);
});
app.get("/api/thumb/:id/:v", (req, res) => res.status(404).end());

// ------------------------------------------------------------------ Stak Cloud runtime for generated apps
const rt = express.Router({ mergeParams: true });
app.use("/api/rt/:pid", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  const p = db.prepare("SELECT id,user_id,title FROM projects WHERE id=?").get(req.params.pid);
  if (!p) return bad(res, 404, "App not found");
  req.project = p;
  const t = bearer(req);
  if (t) {
    const s = db.prepare("SELECT * FROM rt_sessions WHERE token=? AND project_id=?").get(t, p.id);
    if (s) req.rtUser = db.prepare("SELECT * FROM rt_users WHERE id=?").get(s.user_id) || null;
  }
  const writes = req.method !== "GET";
  if (!perMinute(`rt:${p.id}:${ipOf(req)}`, writes ? 90 : 240)) return bad(res, 429, "Too many requests — slow down a little");
  next();
}, rt);

const rtUserView = (u) => u && { id: u.id, name: u.name, email: u.email, created: u.created, ...J(u.data, {}) };
rt.get("/", (req, res) => res.json({ ok: true, project: req.project.id, name: req.project.title }));
rt.get(/^\/assets\/(.+)$/, (req, res) => { if (!sendAsset(res, req.project.id, "assets/" + req.params[0])) bad(res, 404, "Not found"); });
rt.post("/auth/signup", (req, res) => {
  const { name, email, password } = req.body || {};
  const em = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return bad(res, 400, "Please enter a valid email");
  if (String(password || "").length < 6) return bad(res, 400, "Password must be at least 6 characters");
  if (db.prepare("SELECT 1 FROM rt_users WHERE project_id=? AND email=?").get(req.project.id, em)) return bad(res, 409, "An account with this email already exists");
  if (db.prepare("SELECT COUNT(*) c FROM rt_users WHERE project_id=?").get(req.project.id).c > 5000) return bad(res, 403, "This app has reached its user limit");
  const u = { id: "u_" + rid(12), name: String(name || em.split("@")[0]).slice(0, 80), email: em, created: now() };
  db.prepare("INSERT INTO rt_users(id,project_id,name,email,pass,data,created) VALUES(?,?,?,?,?,'{}',?)").run(u.id, req.project.id, u.name, em, hashPass(password), u.created);
  const t = token();
  db.prepare("INSERT INTO rt_sessions(token,project_id,user_id,created) VALUES(?,?,?,?)").run(t, req.project.id, u.id, now());
  res.json({ token: t, user: rtUserView(u) });
});
rt.post("/auth/login", (req, res) => {
  const em = String(req.body?.email || "").trim().toLowerCase();
  if (!perMinute(`rtlogin:${req.project.id}:${em}`, 6)) return bad(res, 429, "Too many attempts — try again in a minute");
  const u = db.prepare("SELECT * FROM rt_users WHERE project_id=? AND email=?").get(req.project.id, em);
  if (!u || !checkPass(req.body?.password || "", u.pass)) return bad(res, 401, "Wrong email or password");
  const t = token();
  db.prepare("INSERT INTO rt_sessions(token,project_id,user_id,created) VALUES(?,?,?,?)").run(t, req.project.id, u.id, now());
  res.json({ token: t, user: rtUserView(u) });
});
rt.post("/auth/logout", (req, res) => { const t = bearer(req); if (t) db.prepare("DELETE FROM rt_sessions WHERE token=?").run(t); res.json({ ok: true }); });
rt.get("/auth/me", (req, res) => res.json({ user: rtUserView(req.rtUser) || null }));
rt.patch("/auth/me", (req, res) => {
  if (!req.rtUser) return bad(res, 401, "Please sign in");
  const { name, email, password, id, created, ...extra } = req.body || {};
  void email; void password; void id; void created;
  const data = { ...J(req.rtUser.data, {}), ...extra };
  if (JSON.stringify(data).length > 20000) return bad(res, 413, "Profile too large");
  db.prepare("UPDATE rt_users SET name=COALESCE(?,name), data=? WHERE id=?").run(name ? String(name).slice(0, 80) : null, JSON.stringify(data), req.rtUser.id);
  res.json({ user: rtUserView(db.prepare("SELECT * FROM rt_users WHERE id=?").get(req.rtUser.id)) });
});

// database
const colOk = (c) => /^[\w-]{1,48}$/.test(c);
const RESERVED = ["id", "owner", "created", "updated"];
const cleanDoc = (b) => { const o = {}; for (const [k, v] of Object.entries(b && typeof b === "object" && !Array.isArray(b) ? b : {})) if (!RESERVED.includes(k)) o[k] = v; return o; };
rt.get("/db/:col", (req, res) => {
  const col = req.params.col; if (!colOk(col)) return bad(res, 400, "Bad collection name");
  if (req.query.mine && !req.rtUser) return bad(res, 401, "Please sign in");
  let rows = db.prepare(`SELECT * FROM rt_docs WHERE project_id=? AND col=? ${req.query.mine ? "AND owner=?" : ""} ORDER BY created DESC LIMIT 5000`)
    .all(...[req.project.id, col, ...(req.query.mine ? [req.rtUser.id] : [])]).map(docView);
  const where = J(req.query.where, null);
  if (where && typeof where === "object") rows = rows.filter((d) => Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(d[k]) : d[k] === v)));
  if (req.query.q) { const q = String(req.query.q).toLowerCase(); rows = rows.filter((d) => JSON.stringify(d).toLowerCase().includes(q)); }
  const sort = String(req.query.sort || "-created");
  const desc = sort.startsWith("-"), key = sort.replace(/^[-+]/, "");
  rows.sort((a, b) => { const x = a[key], y = b[key]; if (x === y) return 0; if (x === undefined) return 1; if (y === undefined) return -1; return (x > y ? 1 : -1) * (desc ? -1 : 1); });
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  res.json(rows.slice(0, limit));
});
rt.get("/db/:col/:id", (req, res) => {
  const d = db.prepare("SELECT * FROM rt_docs WHERE id=? AND project_id=? AND col=?").get(req.params.id, req.project.id, req.params.col);
  if (!d) return bad(res, 404, "Not found");
  res.json(docView(d));
});
rt.post("/db/:col", (req, res) => {
  const col = req.params.col; if (!colOk(col)) return bad(res, 400, "Bad collection name");
  const data = cleanDoc(req.body);
  const s = JSON.stringify(data);
  if (s.length > 200000) return bad(res, 413, "That item is too large");
  if (db.prepare("SELECT COUNT(*) c FROM rt_docs WHERE project_id=?").get(req.project.id).c >= 50000) return bad(res, 403, "This app has reached its storage limit");
  const d = { id: rid(14), project_id: req.project.id, col, owner: req.rtUser?.id || null, data: s, created: now(), updated: now() };
  db.prepare("INSERT INTO rt_docs(id,project_id,col,owner,data,created,updated) VALUES(?,?,?,?,?,?,?)").run(d.id, d.project_id, col, d.owner, s, d.created, d.updated);
  res.json(docView(d));
});
function editableDoc(req, res) {
  const d = db.prepare("SELECT * FROM rt_docs WHERE id=? AND project_id=? AND col=?").get(req.params.id, req.project.id, req.params.col);
  if (!d) { bad(res, 404, "Not found"); return null; }
  if (d.owner && d.owner !== req.rtUser?.id) { bad(res, 403, "Only the person who created this can change it"); return null; }
  return d;
}
rt.patch("/db/:col/:id", (req, res) => {
  const d = editableDoc(req, res); if (!d) return;
  const data = { ...J(d.data, {}), ...cleanDoc(req.body) };
  const s = JSON.stringify(data);
  if (s.length > 200000) return bad(res, 413, "That item is too large");
  db.prepare("UPDATE rt_docs SET data=?, updated=? WHERE id=?").run(s, now(), d.id);
  res.json(docView(db.prepare("SELECT * FROM rt_docs WHERE id=?").get(d.id)));
});
rt.put("/db/:col/:id", (req, res) => {
  const d = editableDoc(req, res); if (!d) return;
  db.prepare("UPDATE rt_docs SET data=?, updated=? WHERE id=?").run(JSON.stringify(cleanDoc(req.body)), now(), d.id);
  res.json(docView(db.prepare("SELECT * FROM rt_docs WHERE id=?").get(d.id)));
});
rt.delete("/db/:col/:id", (req, res) => {
  const d = editableDoc(req, res); if (!d) return;
  db.prepare("DELETE FROM rt_docs WHERE id=?").run(d.id);
  res.json({ ok: true, id: d.id });
});

// AI for generated apps (billed to the Stak owner; capped)
rt.post("/ai/chat", async (req, res) => {
  const pid = req.project.id;
  if (!perMinute(`rtai:${ipOf(req)}`, 12) || !perMinute(`rtai:${pid}`, 40)) return bad(res, 429, "The AI is busy — try again in a few seconds");
  if (bump(`rtai:${pid}`) > 400) return bad(res, 429, "This app reached its daily AI limit");
  const { messages, system, temperature, maxTokens, stream } = req.body || {};
  const msgs = (Array.isArray(messages) ? messages : []).filter((m) => m && m.content).slice(-30).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 12000) }));
  while (msgs.length && msgs[0].role === "assistant") msgs.shift();
  if (!msgs.length) return bad(res, 400, "Send at least one message");
  const opts = { role: "fast", system: String(system || "You are a helpful assistant inside a web app. Be concise.").slice(0, 8000), messages: msgs, maxTokens: Math.min(4000, Number(maxTokens) || 1200), temperature: Math.min(1, Math.max(0, Number(temperature ?? 0.7))) };
  const m = { kind: "builtin", id: "stak:fast" };
  try {
    if (stream) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");
      await llm.stream(m, { ...opts, onText: (t) => res.write(t) });
      return res.end();
    }
    const text = await llm.complete(m, opts);
    res.json({ text });
  } catch (e) {
    if (res.headersSent) return res.end();
    bad(res, 502, "AI request failed — please try again");
  }
});

// real-time web search for generated apps (stak.web.search / stak.web.answer)
rt.post("/web/search", async (req, res) => {
  const pid = req.project.id;
  if (!perMinute(`rtweb:${ipOf(req)}`, 10) || bump(`rtweb:${pid}`) > 500) return bad(res, 429, "Search limit reached — try again later");
  const q = String(req.body?.q || "").trim().slice(0, 300);
  if (!q) return bad(res, 400, "Send a search query");
  try { res.json({ results: await WEB.search(q, { limit: Math.min(10, Number(req.body?.limit) || 6) }) }); }
  catch { bad(res, 502, "Search failed — please try again"); }
});
rt.post("/web/answer", async (req, res) => {
  const pid = req.project.id;
  if (!perMinute(`rtweb:${ipOf(req)}`, 6) || bump(`rtwebai:${pid}`) > 200) return bad(res, 429, "Search limit reached — try again later");
  const q = String(req.body?.q || "").trim().slice(0, 400);
  if (!q) return bad(res, 400, "Send a question");
  try {
    const r = await WEB.research({ topic: q, queries: [q], llm, mode: "answer" });
    if (!r) return bad(res, 502, "No results found");
    res.json({ answer: r.summary, sources: r.sources });
  } catch { bad(res, 502, "Search failed — please try again"); }
});

// external API proxy with secret substitution
rt.get("/secrets", (req, res) => res.json({ names: db.prepare("SELECT name FROM secrets WHERE project_id=?").all(req.project.id).map((r) => r.name) }));
const hostCache = new Map();
function fetchHosts(pid) {
  const v = db.prepare("SELECT n,files FROM versions WHERE project_id=? ORDER BY n DESC LIMIT 1").get(pid);
  const key = `${pid}:${v?.n || 0}`;
  if (hostCache.has(key)) return hostCache.get(key);
  const set = new Set();
  const text = v ? String(v.files) : "";
  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) set.add(m[1].toLowerCase());
  const extra = db.prepare("SELECT value FROM secrets WHERE project_id=? AND name='STAK_FETCH_HOSTS'").get(pid);
  if (extra) for (const x of String(decrypt(extra.value)).split(/[,\s]+/)) if (x) set.add(x.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
  if (hostCache.size > 500) hostCache.clear();
  hostCache.set(key, set);
  return set;
}
rt.post("/fetch", async (req, res) => {
  const pid = req.project.id;
  if (bump(`rtfetch:${pid}`) > 2000) return bad(res, 429, "This app reached its daily API limit");
  const sec = Object.fromEntries(db.prepare("SELECT name,value FROM secrets WHERE project_id=?").all(pid).map((r) => [r.name, decrypt(r.value)]));
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
  if (usesSecret && !fetchHosts(pid).has(u.hostname.toLowerCase())) return bad(res, 403, `Keys can only be sent to API hosts used in this app's code (or listed in the STAK_FETCH_HOSTS key). ${u.hostname} isn't one of them.`);
  try {
    const r = await safeFetch(u.toString(), { method: String(method).toUpperCase(), headers: h, body: /^(GET|HEAD)$/i.test(method) ? undefined : b, signal: AbortSignal.timeout(20000) });
    const buf = Buffer.from(await r.arrayBuffer());
    let text = buf.subarray(0, 2_000_000).toString("utf8");
    for (const v of Object.values(sec)) if (v && v.length > 5) text = text.split(v).join("[secret]");
    res.json({ ok: r.ok, status: r.status, text });
  } catch (e) { bad(res, 502, `Request failed: ${e.message}`); }
});

// uploads
rt.post("/files", (req, res) => {
  const { name, type, data } = req.body || {};
  const m = String(data || "").match(/^data:([^;,]*)(;base64)?,(.*)$/s);
  if (!m) return bad(res, 400, "Send the file as a data URL");
  const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
  if (buf.length > 6 * 1024 * 1024) return bad(res, 413, "Files can be up to 6 MB");
  if (bump(`rtfiles:${req.project.id}`, 1) > 500) return bad(res, 429, "Daily upload limit reached");
  const id = rid(16);
  const t = String(type || m[1] || "application/octet-stream").slice(0, 100);
  db.prepare("INSERT INTO rt_files(id,project_id,name,type,data,created) VALUES(?,?,?,?,?,?)").run(id, req.project.id, String(name || "file").slice(0, 120), t, buf, now());
  res.json({ id, path: `/files/${id}`, name: String(name || "file"), type: t, size: buf.length });
});
rt.get("/files/:fid", (req, res) => {
  const f = db.prepare("SELECT * FROM rt_files WHERE id=? AND project_id=?").get(req.params.fid, req.project.id);
  if (!f) return res.status(404).end();
  const safe = /^(image\/(png|jpe?g|gif|webp|avif)|video\/|audio\/|application\/pdf|text\/plain)/.test(f.type) ? f.type : "application/octet-stream";
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.type(safe).send(f.data);
});
rt.use((req, res) => bad(res, 404, "Unknown Stak Cloud endpoint"));

// ------------------------------------------------------------------ static frontend
// ------------------------------------------------------------------ health / status
const BOOT = now();
app.get("/api/health", (req, res) => res.json({ ok: true, uptime: Math.round((now() - BOOT) / 1000), version: require("../package.json").version }));
app.get("/api/status", (req, res) => res.json({ ...llm.status(), images: IMG.providerChain().map((p) => p.name || p), search: WEB.providers(), jobs: { running: [...Jb.jobs.values()].filter((j) => j.status === "running").length, max: CFG.maxJobs } }));

// ------------------------------------------------------------------ mobile app (Android widgets + notifications)
const PHASE_PROGRESS = { thinking: 0.12, researching: 0.08, planning: 0.1, verifying: 0.85, repairing: 0.88, finishing: 0.95, done: 1 };
function progressOf(j) {
  if (j.status !== "running") return 1;
  const ph = String(j.phase || "");
  if (ph.startsWith("writing:")) return Math.min(0.75, 0.2 + j.doneFiles.length * 0.12);
  if (ph.startsWith("images:")) { const [d, t] = ph.slice(7).split("/").map(Number); return 0.78 + (t ? (d / t) * 0.07 : 0); }
  return PHASE_PROGRESS[ph] ?? 0.15;
}
app.get("/api/mobile/summary", auth, (req, res) => {
  const u = req.user, L = u.guest ? LIMITS.guest : LIMITS.user;
  const projects = db.prepare("SELECT id,title,stage,version,updated FROM projects WHERE user_id=? ORDER BY updated DESC").all(u.id);
  const active = [...Jb.jobs.values()].filter((j) => j.userId === u.id && j.status === "running").map((j) => ({
    jobId: j.id, projectId: j.projectId, title: Jb.getProject(j.projectId)?.title || "Project", type: j.type, phase: j.phase,
    elapsed: Math.round((now() - j.started) / 1000), progress: Math.round(progressOf(j) * 100) / 100, model: j.model,
  }));
  const pending = [];
  for (const p of projects.filter((x) => x.stage === "questions").slice(0, 10)) {
    const q = latestQuestions(p.id);
    if (q && !q.meta.answered && q.meta.status === "ready") pending.push({ projectId: p.id, title: p.title, count: (q.meta.questions || []).length });
  }
  const runningIds = new Set(active.map((a) => a.projectId));
  const thumbOf = (pid) => { const a = db.prepare("SELECT path FROM assets WHERE project_id=? AND mime LIKE 'image/%' ORDER BY created LIMIT 1").get(pid); return a ? `/api/site/${pid}/${a.path}` : null; };
  const recent = projects.slice(0, 8).map((p) => ({ id: p.id, title: p.title, stage: p.stage, running: runningIds.has(p.id), updated: p.updated, version: p.version, url: p.version ? `/api/site/${p.id}/` : null, thumb: thumbOf(p.id) }));
  res.json({
    user: { id: u.id, name: u.name, guest: !!u.guest },
    stats: { projects: projects.length, building: active.length, ready: projects.filter((p) => p.stage === "ready").length, needsAnswers: pending.length },
    usage: { aiUsed: used(`ai:${u.id}`), aiLimit: L.aiDay },
    active, pending, recent, serverTime: now(),
  });
});
app.get("/api/mobile/events", auth, (req, res) => {
  const after = Math.max(0, Number(req.query.after) || 0);
  const rows = after
    ? db.prepare("SELECT * FROM events WHERE user_id=? AND id>? ORDER BY id LIMIT 50").all(req.user.id, after)
    : db.prepare("SELECT * FROM (SELECT * FROM events WHERE user_id=? ORDER BY id DESC LIMIT 20) ORDER BY id").all(req.user.id);
  const last = rows.length ? rows[rows.length - 1].id : (db.prepare("SELECT MAX(id) m FROM events WHERE user_id=?").get(req.user.id).m || after);
  res.json({ events: rows.map((e) => ({ id: e.id, type: e.type, projectId: e.project_id, title: e.title, body: e.body, created: e.created })), last });
});

// ------------------------------------------------------------------ web search for the builder UI (signed-in)
app.post("/api/search", auth, async (req, res) => {
  if (!perMinute(`search:${req.user.id}`, 10)) return bad(res, 429, "Too many searches — wait a moment");
  try { res.json({ results: await WEB.search(String(req.body?.q || ""), { limit: 8 }) }); } catch { bad(res, 502, "Search failed"); }
});

app.use("/api", (req, res) => bad(res, 404, "Not found"));
app.use(express.static(path.join(ROOT, "public"), { index: "index.html", maxAge: "1h" }));
app.use((err, req, res, next) => {
  void next;
  console.error("[error]", err?.message || err);
  if (err?.type === "entity.too.large") return bad(res, 413, "Request too large");
  bad(res, 500, "Something went wrong on our side");
});

// mark interrupted jobs as failed after a restart
db.prepare("UPDATE projects SET stage=CASE WHEN version>0 THEN 'ready' ELSE 'error' END WHERE stage='building'").run();
for (const m of db.prepare("SELECT id,meta FROM messages WHERE kind IN ('build','edit','questions')").all()) {
  const meta = J(m.meta, {});
  if (meta.status === "running" || meta.status === "loading") Jb.updateMessage(m.id, { meta: { status: "error", error: "Interrupted — please retry" } });
}
db.prepare("UPDATE models SET status='failed', result=json_set(result,'$.error','Test interrupted — retest') WHERE status='testing'").run();

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Stak backend on :${PORT} · providers: ${Object.keys(CFG.providers).join(", ") || "none"} · images: ${IMG.providerChain().map((p) => p.name || p).join(", ") || "none"}`);
  llm.refreshHealth().catch(() => {});
});
setInterval(() => llm.refreshHealth().catch(() => {}), 10 * 60e3).unref();
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => {
  console.log(`[${sig}] shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
});

// ------------------------------------------------------------------ stop job
app.post("/api/projects/:id/stop", auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  
  // अगर आपके jobs.js में stopJob फंक्शन है तो वह कॉल होगा
  if (Jb.stopJob) {
    Jb.stopJob(p.id);
  }
  res.json({ ok: true, message: "Generation stopped" });
});

module.exports = app;

// Storage for Stak. One async API, two engines:
//  - Postgres (DATABASE_URL / POSTGRES_URL set)  -> used on Vercel / any serverless host
//  - SQLite (better-sqlite3, file in STAK_DATA_DIR) -> local dev / single VPS
// SQL is written once with "?" placeholders; the Postgres engine rewrites them to $1..$n.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const PG_URL = (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || "").trim();
const DIALECT = PG_URL ? "pg" : "sqlite";

const SCHEMA = (pg) => {
  const ID = pg ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const INT = pg ? "BIGINT" : "INTEGER";
  const BLOB = pg ? "BYTEA" : "BLOB";
  return `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, pass TEXT, guest ${INT} DEFAULT 0, lang TEXT DEFAULT 'en', selected_model TEXT DEFAULT 'stak:auto', created ${INT});
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, visitor TEXT, created ${INT});
CREATE INDEX IF NOT EXISTS sessions_visitor ON sessions(visitor, created);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, title TEXT, prompt TEXT, lang TEXT, stage TEXT, version ${INT} DEFAULT 0, files TEXT DEFAULT '{}', answers TEXT DEFAULT '{}', notes TEXT DEFAULT '', created ${INT}, updated ${INT});
CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id, updated);
CREATE TABLE IF NOT EXISTS messages (id ${ID}, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, role TEXT, kind TEXT, content TEXT, meta TEXT DEFAULT '{}', created ${INT});
CREATE INDEX IF NOT EXISTS messages_project ON messages(project_id, id);
CREATE TABLE IF NOT EXISTS versions (project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, n ${INT}, label TEXT, files TEXT, created ${INT}, PRIMARY KEY (project_id, n));
CREATE TABLE IF NOT EXISTS secrets (project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, name TEXT, value TEXT, created ${INT}, PRIMARY KEY (project_id, name));
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, sub TEXT, created ${INT});
CREATE TABLE IF NOT EXISTS usage (k TEXT, day TEXT, n ${INT} DEFAULT 0, PRIMARY KEY (k, day));
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS rt_users (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, email TEXT, pass TEXT, data TEXT DEFAULT '{}', created ${INT}, UNIQUE(project_id, email));
CREATE TABLE IF NOT EXISTS rt_sessions (token TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, created ${INT});
CREATE TABLE IF NOT EXISTS rt_docs (id TEXT PRIMARY KEY, project_id TEXT, col TEXT, owner TEXT, data TEXT, created ${INT}, updated ${INT});
CREATE INDEX IF NOT EXISTS rt_docs_col ON rt_docs(project_id, col, created);
CREATE TABLE IF NOT EXISTS rt_files (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, type TEXT, data ${BLOB}, created ${INT});
CREATE TABLE IF NOT EXISTS assets (project_id TEXT, path TEXT, mime TEXT, data ${BLOB}, kind TEXT, prompt TEXT, created ${INT}, PRIMARY KEY (project_id, path));
CREATE TABLE IF NOT EXISTS events (id ${ID}, user_id TEXT NOT NULL, type TEXT NOT NULL, project_id TEXT, title TEXT, body TEXT, created ${INT} NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, id);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, type TEXT, project_id TEXT, user_id TEXT, status TEXT, phase TEXT, text TEXT DEFAULT '', done_files TEXT DEFAULT '[]', model TEXT, plan TEXT, notes TEXT DEFAULT '[]', sources TEXT DEFAULT '[]', error TEXT, stop ${INT} DEFAULT 0, started ${INT}, beat ${INT}, finished ${INT});
CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id, status);
CREATE INDEX IF NOT EXISTS jobs_user ON jobs(user_id, status);
`;
};

// ------------------------------------------------------------------ engines
let engine;
if (DIALECT === "pg") {
  const pg = require("pg");
  pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // BIGINT -> number
  pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // NUMERIC (SUM/COUNT casts) -> number
  const pool = new pg.Pool({
    connectionString: PG_URL,
    max: Number(process.env.STAK_PG_POOL || 5),
    idleTimeoutMillis: 10000,
    ssl: /localhost|127\.0\.0\.1/.test(PG_URL) ? false : { rejectUnauthorized: false },
  });
  pool.on("error", (e) => console.warn("[db] pool error", e.message));
  const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  const q = async (sql, args = []) => (await pool.query(toPg(sql), args.map((a) => (a === undefined ? null : a)))).rows;
  engine = {
    all: q,
    get: async (sql, args) => (await q(sql, args))[0],
    run: async (sql, args) => { const r = await pool.query(toPg(sql), (args || []).map((a) => (a === undefined ? null : a))); return { changes: r.rowCount }; },
    insertId: async (sql, args) => { const r = await q(sql + " RETURNING id", args); return Number(r[0].id); },
    exec: async (sql) => { await pool.query(sql); },
    end: () => pool.end(),
  };
} else {
  const Database = require("better-sqlite3");
  const DATA_DIR = process.env.STAK_DATA_DIR ? path.resolve(process.env.STAK_DATA_DIR) : (process.env.VERCEL ? "/tmp/stak" : path.join(ROOT, "data"));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "stak.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const st = new Map();
  const prep = (sql) => { let s = st.get(sql); if (!s) { s = db.prepare(sql); st.set(sql, s); } return s; };
  engine = {
    all: async (sql, args = []) => prep(sql).all(...args),
    get: async (sql, args = []) => prep(sql).get(...args),
    run: async (sql, args = []) => { const r = prep(sql).run(...args); return { changes: r.changes }; },
    insertId: async (sql, args = []) => Number(prep(sql).run(...args).lastInsertRowid),
    exec: async (sql) => { db.exec(sql); },
    end: () => db.close(),
  };
}

let readyP = null;
function ready() {
  if (!readyP) readyP = (async () => {
    const stmts = SCHEMA(DIALECT === "pg").split(";\n").map((s) => s.trim()).filter(Boolean);
    if (DIALECT === "pg") {
      // one round trip; IF NOT EXISTS keeps it idempotent across cold starts
      await engine.exec(stmts.join(";\n") + ";").catch(async (e) => {
        console.warn("[db] bulk schema failed, retrying one by one:", e.message);
        for (const s of stmts) await engine.exec(s).catch((er) => console.warn("[db]", er.message));
      });
    } else await engine.exec(stmts.join(";\n") + ";");
  })().catch((e) => { readyP = null; throw e; });
  return readyP;
}

const db = {
  dialect: DIALECT,
  ready,
  all: async (sql, ...args) => { await ready(); return engine.all(sql, args); },
  get: async (sql, ...args) => { await ready(); return engine.get(sql, args); },
  run: async (sql, ...args) => { await ready(); return engine.run(sql, args); },
  insertId: async (sql, ...args) => { await ready(); return engine.insertId(sql, args); },
  exec: async (sql) => { await ready(); return engine.exec(sql); },
  end: () => engine.end(),
};

// ---- crypto helpers ----
async function kvGet(k) { const r = await db.get("SELECT v FROM kv WHERE k=?", k); return r ? r.v : null; }
async function kvSet(k, v) { await db.run("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, v); }

let KEY = null;
async function key() {
  if (KEY) return KEY;
  let master = process.env.STAK_SECRET;
  if (!master) {
    master = await kvGet("master");
    if (!master) { master = crypto.randomBytes(32).toString("hex"); await kvSet("master", master); master = (await kvGet("master")) || master; }
  }
  KEY = crypto.scryptSync(master, "stak-enc-v1", 32);
  return KEY;
}
async function encrypt(plain) {
  const K = await key();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", K, iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}
async function decrypt(blob) {
  try {
    const K = await key();
    const [iv, tag, enc] = String(blob).split(".").map((x) => Buffer.from(x, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", K, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch { return ""; }
}
function hashPass(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + crypto.scryptSync(String(pw), salt, 64).toString("hex");
}
function checkPass(pw, stored) {
  if (!stored) return false;
  const [salt, h] = stored.split(":");
  const x = crypto.scryptSync(String(pw), salt, 64);
  const y = Buffer.from(h, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const rid = (n = 12) => crypto.randomBytes(n * 2).toString("base64url").replace(/[-_]/g, "").slice(0, n) || rid(n);
const token = () => crypto.randomBytes(24).toString("base64url");
const J = (s, d) => { try { return s ? (typeof s === "string" ? JSON.parse(s) : s) : d; } catch { return d; } };

// ---- usage counters (rate limit + daily caps) ----
const today = () => new Date().toISOString().slice(0, 10);
async function bump(k, n = 1) {
  const d = today();
  await db.run("INSERT INTO usage(k,day,n) VALUES(?,?,?) ON CONFLICT(k,day) DO UPDATE SET n=usage.n+excluded.n", k, d, n);
  const r = await db.get("SELECT n FROM usage WHERE k=? AND day=?", k, d);
  return r ? Number(r.n) : n;
}
async function used(k) { const r = await db.get("SELECT n FROM usage WHERE k=? AND day=?", k, today()); return r ? Number(r.n) : 0; }

module.exports = { db, encrypt, decrypt, hashPass, checkPass, rid, token, J, bump, used, kvGet, kvSet, ROOT, DIALECT };

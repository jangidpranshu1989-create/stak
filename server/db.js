// SQLite storage for Stak (better-sqlite3, synchronous + fast)
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = process.env.STAK_DATA_DIR ? path.resolve(process.env.STAK_DATA_DIR) : ROOT; // mount a volume here in production
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "data.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// schema migrations: shared/migrations/NNN_name.sql, applied once each, in order
db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied INTEGER)");
{
  const dir = path.join(ROOT, "shared", "migrations");
  const done = new Set(db.prepare("SELECT name FROM schema_migrations").all().map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((x) => /^\d+_.+\.sql$/.test(x)).sort()) {
    if (done.has(f)) continue;
    db.transaction(() => { db.exec(fs.readFileSync(path.join(dir, f), "utf8")); db.prepare("INSERT INTO schema_migrations(name,applied) VALUES(?,?)").run(f, Date.now()); })();
    console.log("[db] applied migration", f);
  }
}

// ---- crypto helpers ----
function kvGet(k) { const r = db.prepare("SELECT v FROM kv WHERE k=?").get(k); return r ? r.v : null; }
function kvSet(k, v) { db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, v); }

let master = process.env.STAK_SECRET || kvGet("master");
if (!master) { master = crypto.randomBytes(32).toString("hex"); kvSet("master", master); }
const KEY = crypto.scryptSync(master, "stak-enc-v1", 32);

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}
function decrypt(blob) {
  try {
    const [iv, tag, enc] = String(blob).split(".").map((x) => Buffer.from(x, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
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
const rid = (n = 12) => crypto.randomBytes(n).toString("base64url").replace(/[-_]/g, "").slice(0, n) || rid(n);
const token = () => crypto.randomBytes(24).toString("base64url");
const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// ---- usage counters (rate limit + daily caps) ----
const today = () => new Date().toISOString().slice(0, 10);
function bump(k, n = 1) {
  const d = today();
  db.prepare("INSERT INTO usage(k,day,n) VALUES(?,?,?) ON CONFLICT(k,day) DO UPDATE SET n=n+?").run(k, d, n, n);
  return db.prepare("SELECT n FROM usage WHERE k=? AND day=?").get(k, d).n;
}
function used(k) { const r = db.prepare("SELECT n FROM usage WHERE k=? AND day=?").get(k, today()); return r ? r.n : 0; }

module.exports = { db, encrypt, decrypt, hashPass, checkPass, rid, token, J, bump, used, kvGet, kvSet, ROOT };

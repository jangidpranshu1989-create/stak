-- 001: core tables (users, sessions, projects, messages, versions, secrets, models, push, usage, kv, Stak Cloud runtime)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, pass TEXT, guest INTEGER DEFAULT 0,
  lang TEXT DEFAULT 'en', selected_model TEXT DEFAULT 'stak:pro', created INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  visitor TEXT, created INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_visitor ON sessions(visitor, created);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT, prompt TEXT, lang TEXT, stage TEXT, version INTEGER DEFAULT 0,
  files TEXT DEFAULT '{}', answers TEXT DEFAULT '{}', notes TEXT DEFAULT '',
  created INTEGER, updated INTEGER
);
CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id, updated);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT, kind TEXT, content TEXT, meta TEXT DEFAULT '{}', created INTEGER
);
CREATE INDEX IF NOT EXISTS messages_project ON messages(project_id, id);
CREATE TABLE IF NOT EXISTS versions (
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, n INTEGER, label TEXT,
  files TEXT, created INTEGER, PRIMARY KEY (project_id, n)
);
CREATE TABLE IF NOT EXISTS secrets (
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, name TEXT, value TEXT, created INTEGER,
  PRIMARY KEY (project_id, name)
);
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT, provider_name TEXT, base_url TEXT, api_key TEXT, model TEXT, name TEXT,
  status TEXT, step TEXT, result TEXT DEFAULT '{}', created INTEGER
);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, sub TEXT, created INTEGER
);
CREATE TABLE IF NOT EXISTS usage (k TEXT, day TEXT, n INTEGER DEFAULT 0, PRIMARY KEY (k, day));
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
-- runtime for generated apps (Stak Cloud)
CREATE TABLE IF NOT EXISTS rt_users (
  id TEXT PRIMARY KEY, project_id TEXT, name TEXT, email TEXT, pass TEXT, data TEXT DEFAULT '{}', created INTEGER,
  UNIQUE(project_id, email)
);
CREATE TABLE IF NOT EXISTS rt_sessions (token TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS rt_docs (
  id TEXT PRIMARY KEY, project_id TEXT, col TEXT, owner TEXT, data TEXT, created INTEGER, updated INTEGER
);
CREATE INDEX IF NOT EXISTS rt_docs_col ON rt_docs(project_id, col, created);
CREATE TABLE IF NOT EXISTS rt_files (
  id TEXT PRIMARY KEY, project_id TEXT, name TEXT, type TEXT, data BLOB, created INTEGER
);

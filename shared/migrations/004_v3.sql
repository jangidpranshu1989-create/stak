-- 004 (v3): intent kind + blueprint per project, durable job log, Stak Cloud roles & rules, session expiry
ALTER TABLE projects ADD COLUMN kind TEXT DEFAULT 'app';
ALTER TABLE projects ADD COLUMN blueprint TEXT DEFAULT '';
ALTER TABLE projects ADD COLUMN rules TEXT DEFAULT '';
ALTER TABLE rt_users ADD COLUMN role TEXT DEFAULT 'user';
ALTER TABLE sessions ADD COLUMN expires INTEGER DEFAULT 0;
ALTER TABLE rt_sessions ADD COLUMN expires INTEGER DEFAULT 0;
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, type TEXT, status TEXT, phase TEXT,
  model TEXT, error TEXT, report TEXT DEFAULT '{}', started INTEGER, finished INTEGER
);
CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id, started);
CREATE INDEX IF NOT EXISTS rt_docs_owner ON rt_docs(project_id, col, owner);

-- 002: binary site assets — user photo uploads (assets/uploads/*) and AI-generated photos (assets/img/*)
CREATE TABLE IF NOT EXISTS assets (
  project_id TEXT, path TEXT, mime TEXT, data BLOB, kind TEXT, prompt TEXT, created INTEGER,
  PRIMARY KEY (project_id, path)
);

-- v2.0: event log for the Android app (notifications + widgets) and job bookkeeping
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,            -- questions_ready | build_done | edit_done | job_failed
  project_id TEXT,
  title TEXT,
  body TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, id);

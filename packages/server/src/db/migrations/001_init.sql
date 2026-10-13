-- Gantry initial schema. Runtime state only: project *definitions* live in
-- gantry.yaml files; this database stores tickets, runs, jobs, preview state.

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace TEXT NOT NULL,
  config_path TEXT NOT NULL,
  default_agent TEXT NOT NULL,
  default_prompt_template TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  scope TEXT NOT NULL DEFAULT 'both',
  branch TEXT NOT NULL,
  additions TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  active_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX tickets_active_run ON tickets(active_run_id) WHERE active_run_id IS NOT NULL;
CREATE INDEX tickets_board ON tickets(project_id, status, position);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  state TEXT NOT NULL,
  session_id TEXT,
  workspace TEXT,
  pid INTEGER,
  pgid INTEGER,
  pid_claim TEXT,
  started_at TEXT,
  ended_at TEXT,
  exit_code INTEGER,
  error TEXT
);
CREATE INDEX runs_ticket ON runs(ticket_id);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  project_id TEXT,
  ticket_id TEXT,
  dedupe_key TEXT,
  state TEXT NOT NULL DEFAULT 'queued',
  phase TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT NOT NULL,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX jobs_active_dedupe ON jobs(dedupe_key) WHERE state IN ('queued', 'running') AND dedupe_key IS NOT NULL;
CREATE INDEX jobs_pick ON jobs(state, run_after);

CREATE TABLE previews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'discovered',
  environment TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  retired INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  ticket_id TEXT,
  merge_evidence TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, branch)
);

CREATE TABLE preview_checkouts (
  preview_id TEXT NOT NULL REFERENCES previews(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL,
  path TEXT NOT NULL,
  head TEXT,
  branch TEXT,
  is_fallback INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (preview_id, repository_id)
);

CREATE TABLE preview_services (
  preview_id TEXT NOT NULL REFERENCES previews(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'stopped',
  pid INTEGER,
  pgid INTEGER,
  pid_claim TEXT,
  signature TEXT,
  port INTEGER,
  started_at TEXT,
  error TEXT,
  retry_after TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (preview_id, service_id)
);

CREATE TABLE port_allocations (
  project_id TEXT NOT NULL,
  preview_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  port INTEGER NOT NULL,
  PRIMARY KEY (project_id, preview_id, service_id)
);

CREATE TABLE artifact_files (
  ticket_id TEXT NOT NULL,
  file TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (ticket_id, file)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

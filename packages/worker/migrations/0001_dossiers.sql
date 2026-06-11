CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'contributor',
  reputation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dossiers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'early',
  readiness INTEGER NOT NULL DEFAULT 0,
  buyer TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  missing TEXT NOT NULL DEFAULT '',
  assets_json TEXT NOT NULL DEFAULT '[]',
  source_idea_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS diligence_notes (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dossier_id) REFERENCES dossiers(id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS interest_signals (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  type TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (dossier_id, profile_id, type),
  FOREIGN KEY (dossier_id) REFERENCES dossiers(id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS graduation_events (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  target_store TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dossier_id) REFERENCES dossiers(id)
);

CREATE INDEX IF NOT EXISTS idx_dossiers_status ON dossiers(status);
CREATE INDEX IF NOT EXISTS idx_dossiers_readiness ON dossiers(readiness);
CREATE INDEX IF NOT EXISTS idx_notes_dossier ON diligence_notes(dossier_id, created_at);
CREATE INDEX IF NOT EXISTS idx_interest_dossier ON interest_signals(dossier_id, type);

INSERT OR IGNORE INTO profiles (id, handle, display_name, role, reputation) VALUES
  ('profile-system', 'system', 'Idea Store Seeder', 'system', 0);

INSERT OR IGNORE INTO dossiers (id, title, readiness, type, status, summary, buyer, evidence, missing, assets_json, source_idea_id, created_by) VALUES
  ('asx-filings-analyst', 'ASX Filings Analyst', 72, 'research-saas', 'diligence', 'A citation-first ASX company report analyst that produces weekly valuation watchlists from public filings and licensed market data.', 'Australian retail investors and small research teams.', 'Competitor review complete; public-source wedge identified; regulatory risk mapped.', 'Manual pilot with paying or high-intent users.', '["research memo","MVP scope","risk memo"]', 'asx-filings-analyst', 'profile-system'),
  ('parent-volleyball-community', 'Parent Volleyball Community', 64, 'community-app', 'prototype', 'A team-centered parent coordination app focused on communication, attendance, fixtures, and lightweight community support.', 'Local clubs, team managers, and parent groups.', 'Prototype direction and competitor comparison exist.', 'Club pilot and weekly retention data.', '["prototype","competitor memo","pilot plan"]', 'parent-volleyball-community', 'profile-system'),
  ('idea-reputation-engine', 'Idea Reputation Engine', 58, 'platform', 'concept', 'A reputation layer that credits people for critiques, pivots, research, prototypes, and kill signals across the idea lifecycle.', 'Open Frontier contributors, builders, founders, and investors.', 'Fits the existing app/game store people-as-product model.', 'Badge taxonomy and anti-spam mechanics.', '["product thesis","lifecycle map"]', 'idea-reputation-system', 'profile-system'),
  ('school-transport-trust-layer', 'School Transport Trust Layer', 41, 'local-services', 'early', 'A trust and coordination layer for parents evaluating safe transport options for young children.', 'Parents, schools, transport operators, and local service coordinators.', 'Need area identified; risk profile documented.', 'Regulatory diligence and parent interviews.', '["problem memo","risk memo"]', 'school-transport-options', 'profile-system');


-- One row per "Trudy day" (4am-4am Pacific).
CREATE TABLE IF NOT EXISTS days (
  date       TEXT PRIMARY KEY,   -- YYYY-MM-DD (Pacific, day starts 4am)
  assignee   TEXT,               -- @username tagged at 7am
  backup     TEXT,               -- @username tagged at escalation
  fed_by     TEXT,
  fed_at     TEXT,
  caged_by   TEXT,
  caged_at   TEXT
);

-- Every /walked, so there's a history of walks and potty results.
CREATE TABLE IF NOT EXISTS walks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  date              TEXT NOT NULL,
  walker_name       TEXT NOT NULL,
  walker_id         INTEGER,
  walked_at         TEXT NOT NULL,  -- ISO UTC
  pee               INTEGER,        -- NULL = not answered yet, 0/1
  poo               INTEGER,
  prompt_message_id INTEGER         -- the "did I go pee or poo?" message
);
CREATE INDEX IF NOT EXISTS walks_date ON walks(date);
CREATE INDEX IF NOT EXISTS walks_prompt ON walks(prompt_message_id);

-- Which scheduled messages went out, so each fires once per day.
CREATE TABLE IF NOT EXISTS sent_slots (
  date    TEXT NOT NULL,
  slot    TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (date, slot)
);

-- Small key/value bits (tag rotation bag).
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Everyone who has ever used /walked. Tagging is only switched on once enough
-- different people have walked Trudy, and only people in this table (who have
-- a username and haven't opted out with /notag) are ever tagged.
CREATE TABLE IF NOT EXISTS walkers (
  user_id         INTEGER PRIMARY KEY,
  username        TEXT,            -- without "@"; NULL if they have none
  first_name      TEXT NOT NULL,
  first_walked_at TEXT NOT NULL,
  last_walked_at  TEXT NOT NULL,
  walk_count      INTEGER NOT NULL DEFAULT 0,
  opted_out       INTEGER NOT NULL DEFAULT 0
);

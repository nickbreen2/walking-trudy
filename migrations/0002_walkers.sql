-- Everyone who has used /walked, /join or /leave. Tagging is only switched on
-- once enough different people have walked Trudy, and then only people who
-- walked her or sent /join (and have a username, and haven't sent /leave).
CREATE TABLE IF NOT EXISTS walkers (
  user_id         INTEGER PRIMARY KEY,
  username        TEXT,            -- without "@"; NULL if they have none
  first_name      TEXT NOT NULL,
  first_walked_at TEXT NOT NULL,
  last_walked_at  TEXT NOT NULL,
  walk_count      INTEGER NOT NULL DEFAULT 0,
  joined          INTEGER NOT NULL DEFAULT 0,  -- sent /join
  opted_out       INTEGER NOT NULL DEFAULT 0   -- sent /leave
);

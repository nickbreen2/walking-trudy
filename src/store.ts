// Persistence. D1Store is used in production; MemoryStore is for tests.

export interface DayRow {
  date: string;
  assignee: string | null;
  backup: string | null;
  fed_by: string | null;
  fed_at: string | null;
  caged_by: string | null;
  caged_at: string | null;
}

export interface WalkRow {
  id: number;
  date: string;
  walker_name: string;
  walker_id: number | null;
  walked_at: string;
  pee: number | null;
  poo: number | null;
  prompt_message_id: number | null;
}

export interface WalkerRow {
  user_id: number;
  username: string | null;
  first_name: string;
  first_walked_at: string;
  last_walked_at: string;
  walk_count: number;
  joined: number;
  opted_out: number;
}

export interface WalkerInfo {
  userId: number;
  username: string | null;
  firstName: string;
}

export type DayPatch = Partial<Omit<DayRow, "date">>;

export interface NewWalk {
  date: string;
  walkerName: string;
  walkerId: number | null;
  walkedAt: string;
  pee: boolean | null;
  poo: boolean | null;
}

export interface Store {
  getDay(date: string): Promise<DayRow | null>;
  updateDay(date: string, patch: DayPatch): Promise<void>;
  addWalk(w: NewWalk): Promise<number>;
  getWalk(id: number): Promise<WalkRow | null>;
  setWalkPotty(id: number, pee: boolean, poo: boolean): Promise<void>;
  setWalkPrompt(id: number, messageId: number): Promise<void>;
  findWalkByPrompt(messageId: number): Promise<WalkRow | null>;
  walksOn(date: string): Promise<WalkRow[]>;
  /** Returns true if this call claimed the slot (it wasn't sent yet). */
  claimSlot(date: string, slot: string, at: string): Promise<boolean>;
  releaseSlot(date: string, slot: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  /** Most recent walk ever (across days). */
  lastWalk(): Promise<WalkRow | null>;
  /** Record that this person walked Trudy. Returns true if it's their first walk ever. */
  recordWalker(w: WalkerInfo, at: string): Promise<boolean>;
  /** Number of different people who have walked Trudy. */
  walkerCount(): Promise<number>;
  /** "@username"s who can be tagged: walked or joined, have a username, haven't left. */
  taggableWalkers(): Promise<string[]>;
  /** /join (ok to tag) or /leave (never tag). */
  setTagPref(w: WalkerInfo, pref: "join" | "leave", at: string): Promise<void>;
}

const DAY_COLUMNS = ["assignee", "backup", "fed_by", "fed_at", "caged_by", "caged_at"] as const;

const b = (v: boolean | null) => (v === null ? null : v ? 1 : 0);

export class D1Store implements Store {
  constructor(private db: D1Database) {}

  async getDay(date: string) {
    return (await this.db.prepare("SELECT * FROM days WHERE date = ?").bind(date).first<DayRow>()) ?? null;
  }

  async updateDay(date: string, patch: DayPatch) {
    await this.db.prepare("INSERT OR IGNORE INTO days (date) VALUES (?)").bind(date).run();
    const cols = DAY_COLUMNS.filter((c) => c in patch);
    if (!cols.length) return;
    const sql = `UPDATE days SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE date = ?`;
    await this.db
      .prepare(sql)
      .bind(...cols.map((c) => patch[c] ?? null), date)
      .run();
  }

  async addWalk(w: NewWalk) {
    const res = await this.db
      .prepare(
        "INSERT INTO walks (date, walker_name, walker_id, walked_at, pee, poo) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(w.date, w.walkerName, w.walkerId, w.walkedAt, b(w.pee), b(w.poo))
      .run();
    return Number(res.meta.last_row_id);
  }

  async getWalk(id: number) {
    return (await this.db.prepare("SELECT * FROM walks WHERE id = ?").bind(id).first<WalkRow>()) ?? null;
  }

  async setWalkPotty(id: number, pee: boolean, poo: boolean) {
    await this.db.prepare("UPDATE walks SET pee = ?, poo = ? WHERE id = ?").bind(b(pee), b(poo), id).run();
  }

  async setWalkPrompt(id: number, messageId: number) {
    await this.db.prepare("UPDATE walks SET prompt_message_id = ? WHERE id = ?").bind(messageId, id).run();
  }

  async findWalkByPrompt(messageId: number) {
    return (
      (await this.db
        .prepare("SELECT * FROM walks WHERE prompt_message_id = ? ORDER BY id DESC LIMIT 1")
        .bind(messageId)
        .first<WalkRow>()) ?? null
    );
  }

  async walksOn(date: string) {
    const res = await this.db.prepare("SELECT * FROM walks WHERE date = ? ORDER BY walked_at").bind(date).all<WalkRow>();
    return res.results ?? [];
  }

  async claimSlot(date: string, slot: string, at: string) {
    const res = await this.db
      .prepare("INSERT OR IGNORE INTO sent_slots (date, slot, sent_at) VALUES (?, ?, ?)")
      .bind(date, slot, at)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }

  async releaseSlot(date: string, slot: string) {
    await this.db.prepare("DELETE FROM sent_slots WHERE date = ? AND slot = ?").bind(date, slot).run();
  }

  async getMeta(key: string) {
    const row = await this.db.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first<{ value: string }>();
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string) {
    await this.db
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(key, value)
      .run();
  }

  async lastWalk() {
    return (await this.db.prepare("SELECT * FROM walks ORDER BY walked_at DESC LIMIT 1").first<WalkRow>()) ?? null;
  }

  async recordWalker(w: WalkerInfo, at: string) {
    const prev = await this.db
      .prepare("SELECT walk_count FROM walkers WHERE user_id = ?")
      .bind(w.userId)
      .first<{ walk_count: number }>();
    await this.db
      .prepare(
        `INSERT INTO walkers (user_id, username, first_name, first_walked_at, last_walked_at, walk_count)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(user_id) DO UPDATE SET
           username = excluded.username,
           first_name = excluded.first_name,
           first_walked_at = CASE WHEN walkers.walk_count = 0 THEN excluded.first_walked_at ELSE walkers.first_walked_at END,
           last_walked_at = excluded.last_walked_at,
           walk_count = walkers.walk_count + 1`,
      )
      .bind(w.userId, w.username, w.firstName, at, at)
      .run();
    return !prev || prev.walk_count === 0;
  }

  async walkerCount() {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM walkers WHERE walk_count > 0").first<{ n: number }>();
    return Number(row?.n ?? 0);
  }

  async taggableWalkers() {
    const res = await this.db
      .prepare(
        "SELECT username FROM walkers WHERE (walk_count > 0 OR joined = 1) AND opted_out = 0 AND username IS NOT NULL AND username != '' ORDER BY first_walked_at",
      )
      .all<{ username: string }>();
    return (res.results ?? []).map((r) => "@" + r.username);
  }

  async setTagPref(w: WalkerInfo, pref: "join" | "leave", at: string) {
    const joined = pref === "join" ? 1 : 0;
    await this.db
      .prepare(
        `INSERT INTO walkers (user_id, username, first_name, first_walked_at, last_walked_at, walk_count, joined, opted_out)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           joined = excluded.joined, opted_out = excluded.opted_out, username = excluded.username`,
      )
      .bind(w.userId, w.username, w.firstName, at, at, joined, 1 - joined)
      .run();
  }
}

export class MemoryStore implements Store {
  days = new Map<string, DayRow>();
  walks: WalkRow[] = [];
  slots = new Set<string>();
  meta = new Map<string, string>();
  walkers = new Map<number, WalkerRow>();

  async getDay(date: string) {
    return this.days.get(date) ?? null;
  }
  async updateDay(date: string, patch: DayPatch) {
    const cur: DayRow = this.days.get(date) ?? {
      date,
      assignee: null,
      backup: null,
      fed_by: null,
      fed_at: null,
      caged_by: null,
      caged_at: null,
    };
    this.days.set(date, { ...cur, ...patch });
  }
  async addWalk(w: NewWalk) {
    const id = this.walks.length + 1;
    this.walks.push({
      id,
      date: w.date,
      walker_name: w.walkerName,
      walker_id: w.walkerId,
      walked_at: w.walkedAt,
      pee: b(w.pee),
      poo: b(w.poo),
      prompt_message_id: null,
    });
    return id;
  }
  async getWalk(id: number) {
    return this.walks.find((w) => w.id === id) ?? null;
  }
  async setWalkPotty(id: number, pee: boolean, poo: boolean) {
    const w = this.walks.find((x) => x.id === id);
    if (w) Object.assign(w, { pee: b(pee), poo: b(poo) });
  }
  async setWalkPrompt(id: number, messageId: number) {
    const w = this.walks.find((x) => x.id === id);
    if (w) w.prompt_message_id = messageId;
  }
  async findWalkByPrompt(messageId: number) {
    return [...this.walks].reverse().find((w) => w.prompt_message_id === messageId) ?? null;
  }
  async walksOn(date: string) {
    return this.walks.filter((w) => w.date === date);
  }
  async claimSlot(date: string, slot: string) {
    const k = `${date}|${slot}`;
    if (this.slots.has(k)) return false;
    this.slots.add(k);
    return true;
  }
  async releaseSlot(date: string, slot: string) {
    this.slots.delete(`${date}|${slot}`);
  }
  async getMeta(key: string) {
    return this.meta.get(key) ?? null;
  }
  async setMeta(key: string, value: string) {
    this.meta.set(key, value);
  }
  async lastWalk() {
    return [...this.walks].sort((a, b) => b.walked_at.localeCompare(a.walked_at))[0] ?? null;
  }
  async recordWalker(w: WalkerInfo, at: string) {
    const cur = this.walkers.get(w.userId);
    const isNew = !cur || cur.walk_count === 0;
    this.walkers.set(w.userId, {
      user_id: w.userId,
      username: w.username,
      first_name: w.firstName,
      first_walked_at: isNew ? at : cur!.first_walked_at,
      last_walked_at: at,
      walk_count: (cur?.walk_count ?? 0) + 1,
      joined: cur?.joined ?? 0,
      opted_out: cur?.opted_out ?? 0,
    });
    return isNew;
  }
  async walkerCount() {
    return [...this.walkers.values()].filter((w) => w.walk_count > 0).length;
  }
  async taggableWalkers() {
    return [...this.walkers.values()]
      .filter((w) => (w.walk_count > 0 || w.joined) && !w.opted_out && w.username)
      .sort((a, b) => a.first_walked_at.localeCompare(b.first_walked_at))
      .map((w) => "@" + w.username);
  }
  async setTagPref(w: WalkerInfo, pref: "join" | "leave", at: string) {
    const cur = this.walkers.get(w.userId);
    this.walkers.set(w.userId, {
      user_id: w.userId,
      username: w.username,
      first_name: w.firstName,
      first_walked_at: cur?.first_walked_at ?? at,
      last_walked_at: cur?.last_walked_at ?? at,
      walk_count: cur?.walk_count ?? 0,
      joined: pref === "join" ? 1 : 0,
      opted_out: pref === "leave" ? 1 : 0,
    });
  }
}

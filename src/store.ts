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
}

export class MemoryStore implements Store {
  days = new Map<string, DayRow>();
  walks: WalkRow[] = [];
  slots = new Set<string>();
  meta = new Map<string, string>();

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
}

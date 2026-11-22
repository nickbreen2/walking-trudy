// Walk scoreboards: who walked the dog the most today / this week / this month.
// Dates here are "dog days" (YYYY-MM-DD, 4am-4am local), the same as walks.date.

import { escapeHtml, pickOne } from "./messages";
import type { WalkRow } from "./store";

export type Period = "day" | "week" | "month";

const DAY_MS = 86_400_000;
const toDate = (d: string) => new Date(d + "T12:00:00Z");
const toStr = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => toStr(new Date(toDate(d).getTime() + n * DAY_MS));

const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(toDate(d));

export function isLastDayOfMonth(date: string): boolean {
  return addDays(date, 1).slice(0, 7) !== date.slice(0, 7);
}

export function monthName(date: string): string {
  return fmt(date, { month: "long" });
}

/** Inclusive date range for the period containing `date`. Weeks run Monday–Sunday. */
export function periodRange(date: string, period: Period): { start: string; end: string; label: string } {
  if (period === "day") {
    return { start: date, end: date, label: fmt(date, { weekday: "short", month: "short", day: "numeric" }) };
  }
  if (period === "week") {
    const mondayOffset = (toDate(date).getUTCDay() + 6) % 7;
    const start = addDays(date, -mondayOffset);
    const end = addDays(start, 6);
    const short = (d: string) => fmt(d, { month: "short", day: "numeric" });
    return { start, end, label: `${short(start)} – ${short(end)}` };
  }
  const start = date.slice(0, 8) + "01";
  let end = date;
  while (!isLastDayOfMonth(end)) end = addDays(end, 1);
  return { start, end, label: fmt(date, { month: "long", year: "numeric" }) };
}

export interface Entry {
  name: string;
  count: number;
  rank: number; // 1-based; tied counts share a rank (1, 1, 3, ...)
}

/** Count walks per person (by Relay user id, else name), most walks first. */
export function tally(walks: WalkRow[]): Entry[] {
  const byPerson = new Map<string, { name: string; count: number; lastAt: string }>();
  for (const w of walks) {
    const key = w.walker_id !== null ? `id:${w.walker_id}` : `name:${w.walker_name}`;
    const cur = byPerson.get(key);
    if (!cur) byPerson.set(key, { name: w.walker_name, count: 1, lastAt: w.walked_at });
    else {
      cur.count++;
      if (w.walked_at >= cur.lastAt) Object.assign(cur, { name: w.walker_name, lastAt: w.walked_at });
    }
  }
  const sorted = [...byPerson.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return sorted.map((p, i) => ({
    name: p.name,
    count: p.count,
    rank: sorted.findIndex((q) => q.count === p.count) + 1,
  }));
}

export function topWalkers(entries: Entry[]): string[] {
  return entries.filter((e) => e.rank === 1).map((e) => e.name);
}

/** "Nick", "Nick and Matt", "Nick, Matt and Luiz" */
export function joinNames(names: string[]): string {
  const safe = names.map(escapeHtml);
  if (safe.length <= 1) return safe[0] ?? "";
  return `${safe.slice(0, -1).join(", ")} and ${safe[safe.length - 1]}`;
}

const MEDALS = ["🥇", "🥈", "🥉"];
const TITLES: Record<Period, string> = {
  day: "Walks Today",
  week: "Weekly Walk Scoreboard",
  month: "Monthly Walk Scoreboard",
};
const EMPTY: Record<Period, string> = {
  day: "No walks yet today 🥺",
  week: "No walks logged this week 🥺",
  month: "No walks logged this month 🥺",
};

export function scoreboardText(dogName: string, period: Period, label: string, entries: Entry[]): string {
  const head = `🏆 <b>${escapeHtml(dogName)}'s ${TITLES[period]}</b>\n<i>${label}</i>\n`;
  if (!entries.length) return `${head}\n${EMPTY[period]} Be the first: /walked`;

  const rows = entries.map((e) => {
    const badge = MEDALS[e.rank - 1] ?? `${e.rank}.`;
    return `${badge} ${escapeHtml(e.name)} — ${e.count} walk${e.count === 1 ? "" : "s"}`;
  });
  const total = entries.reduce((n, e) => n + e.count, 0);
  const people = entries.length;
  return `${head}\n${rows.join("\n")}\n\n🐾 ${total} walk${total === 1 ? "" : "s"} from ${people} ${people === 1 ? "person" : "people"}`;
}

/** The separate "thank you" message after the scheduled weekly/monthly scoreboard. */
export function thanksText(period: "week" | "month", names: string[], date: string, random: () => number): string {
  const who = joinNames(names);
  const many = names.length > 1;
  if (period === "week") {
    return pickOne(
      [
        `Thanks ${who} for walking me the most this week ❤️ You're the best!`,
        `${who}, you walked me the most this week! Thank you ❤️🐾 You're the best!`,
      ],
      random,
    );
  }
  const month = monthName(date);
  return pickOne(
    [
      `🏅 ${who} walked me the most in ${month}! Thank you for all the love ❤️🐶 You're my favorite ${many ? "humans" : "human"}.`,
      `🏅 ${month}'s top walker${many ? "s" : ""}: ${who}! I love you so much ❤️🐾 Thank you for taking such good care of me.`,
    ],
    random,
  );
}

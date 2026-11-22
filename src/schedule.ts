// Trudy's daily schedule, in local (Pacific) time. Edit this file to change timing.
//
// The cron fires every 15 minutes; a slot is sent on the first tick at or after
// hour:minute within that hour, once per day. `when` makes it conditional.

import { isLastDayOfMonth } from "./scoreboard";

export type SlotKind = "walk" | "food_water" | "crate_ask" | "weekly_scoreboard" | "monthly_scoreboard";
export type Condition = "not_walked_recently" | "not_caged";

export interface Slot {
  id: string;
  kind: SlotKind;
  hour: number;
  minute?: number;
  when?: Condition;
  /** Only on certain days. Default: every day (subject to ACTIVE_DAYS). */
  on?: "sunday" | "last_day_of_month";
}

/** Walk reminders every 2 hours, 7am through 9pm (last call). */
export const WALK_HOURS = [7, 9, 11, 13, 15, 17, 19, 21];
export const FIRST_WALK_HOUR = WALK_HOURS[0]!;
export const LAST_WALK_HOUR = WALK_HOURS[WALK_HOURS.length - 1]!;

/** A walk reminder is skipped if Trudy was walked within this many minutes. */
export const RECENT_WALK_MINUTES = 120;

const pad = (n: number) => String(n).padStart(2, "0");

export const SCHEDULE: Slot[] = [
  ...WALK_HOURS.map((hour) => ({
    id: `walk_${pad(hour)}`,
    kind: "walk" as const,
    hour,
    when: "not_walked_recently" as const,
  })),
  { id: "food_water_12", kind: "food_water", hour: 12 }, // no response needed
  { id: "food_water_18", kind: "food_water", hour: 18 }, // no response needed
  { id: "crate_ask", kind: "crate_ask", hour: 22, when: "not_caged" }, // one bedtime ask, no follow-up
  // Scoreboards at 8:30pm: after the 7pm walk, before the 9pm last call.
  { id: "weekly_scoreboard", kind: "weekly_scoreboard", hour: 20, minute: 30, on: "sunday" },
  { id: "monthly_scoreboard", kind: "monthly_scoreboard", hour: 20, minute: 30, on: "last_day_of_month" },
];

export const isScoreboard = (s: Slot) => s.kind === "weekly_scoreboard" || s.kind === "monthly_scoreboard";

/** Whether a slot runs on this dog day (YYYY-MM-DD, weekday "Mon".."Sun"). */
export function runsOn(slot: Slot, date: string, weekday: string): boolean {
  if (slot.on === "sunday") return weekday === "Sun";
  if (slot.on === "last_day_of_month") return isLastDayOfMonth(date);
  return true;
}

export function dueSlots(hour: number, minute: number, schedule: Slot[] = SCHEDULE): Slot[] {
  return schedule.filter((s) => s.hour === hour && minute >= (s.minute ?? 0));
}

export function findSlot(id: string): Slot | undefined {
  return SCHEDULE.find((s) => s.id === id);
}

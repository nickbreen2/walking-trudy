// Trudy's daily schedule, in local (Pacific) time. Edit this file to change timing.
//
// The cron fires every 15 minutes; a slot is sent on the first tick at or after
// hour:minute within that hour, once per day. `when` makes it conditional.

export type SlotKind = "walk" | "food_water" | "crate_ask" | "crate_nudge";
export type Condition = "not_walked_recently" | "not_caged";

export interface Slot {
  id: string;
  kind: SlotKind;
  hour: number;
  minute?: number;
  when?: Condition;
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
  { id: "crate_ask", kind: "crate_ask", hour: 22, when: "not_caged" },
  { id: "crate_nudge", kind: "crate_nudge", hour: 23, when: "not_caged" },
];

export function dueSlots(hour: number, minute: number, schedule: Slot[] = SCHEDULE): Slot[] {
  return schedule.filter((s) => s.hour === hour && minute >= (s.minute ?? 0));
}

export function findSlot(id: string): Slot | undefined {
  return SCHEDULE.find((s) => s.id === id);
}

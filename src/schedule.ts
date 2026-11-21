// Trudy's daily schedule, in local (Pacific) time. Edit this file to change timing.
//
// The cron fires every 15 minutes; a slot is sent on the first tick at or after
// hour:minute within that hour, once per day. `when` makes it conditional.

export type SlotId =
  | "walk_ask"
  | "walk_nudge"
  | "walk_desperate"
  | "walk_sos"
  | "food_water_midday"
  | "food_water_evening"
  | "crate_ask"
  | "crate_nudge";

export type Condition = "not_walked" | "not_caged";

export interface Slot {
  id: SlotId;
  hour: number;
  minute?: number;
  when?: Condition;
}

export const SCHEDULE: Slot[] = [
  { id: "walk_ask", hour: 7, when: "not_walked" }, // tag today's walker
  { id: "walk_nudge", hour: 9, when: "not_walked" }, // "Still waiting on my walk"
  { id: "walk_desperate", hour: 11, when: "not_walked" }, // tag walker + a backup
  { id: "walk_sos", hour: 13, when: "not_walked" }, // last-ditch, no new tags
  { id: "food_water_midday", hour: 12 }, // no response needed
  { id: "food_water_evening", hour: 18 }, // no response needed
  { id: "crate_ask", hour: 22, when: "not_caged" },
  { id: "crate_nudge", hour: 23, when: "not_caged" },
];

export function dueSlots(hour: number, minute: number, schedule: Slot[] = SCHEDULE): Slot[] {
  return schedule.filter((s) => s.hour === hour && minute >= (s.minute ?? 0));
}

export function findSlot(id: string): Slot | undefined {
  return SCHEDULE.find((s) => s.id === id);
}

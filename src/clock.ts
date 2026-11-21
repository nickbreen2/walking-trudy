// Time helpers. Everything runs in Trudy's local time zone (Pacific by default),
// computed from UTC on every tick, so daylight saving time is handled for free.

/** A "Trudy day" runs from 4am to 4am local, so a /caged at 12:30am counts for the night before. */
export const DAY_START_HOUR = 4;

export interface LocalClock {
  date: string; // YYYY-MM-DD of the Trudy day
  hour: number; // local wall-clock hour 0-23
  minute: number;
  weekday: string; // Mon..Sun of the Trudy day
}

function parts(d: Date, tz: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

export function localClock(now: Date, tz: string): LocalClock {
  const wall = parts(now, tz);
  const day = parts(new Date(now.getTime() - DAY_START_HOUR * 3600_000), tz);
  return {
    date: `${day.year}-${day.month}-${day.day}`,
    hour: Number(wall.hour) % 24,
    minute: Number(wall.minute),
    weekday: day.weekday ?? "",
  };
}

/** "8:14 AM" in the given zone. */
export function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

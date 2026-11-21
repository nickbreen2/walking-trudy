export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_API_URL: string;
  WEBHOOK_SECRET: string;
  ADMIN_SECRET: string;
  GROUP_CHAT_ID?: string;
  TOPIC_ID?: string;
  TAGGING_THRESHOLD?: string;
  TIMEZONE?: string;
  ALLOW_DM_COMMANDS?: string;
  ACTIVE_DAYS?: string;
}

export interface Config {
  groupChatId: number | null;
  topicId: number | null;
  /** Tagging turns on once this many different people have used /walked. */
  taggingThreshold: number;
  timezone: string;
  allowDmCommands: boolean;
  activeDays: string[]; // "Mon".."Sun"
}

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toInt(v: string | undefined): number | null {
  if (!v || !v.trim()) return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

export function loadConfig(env: Partial<Env>): Config {
  const days = (env.ACTIVE_DAYS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => ALL_DAYS.includes(d));
  return {
    groupChatId: toInt(env.GROUP_CHAT_ID),
    topicId: toInt(env.TOPIC_ID),
    taggingThreshold: toInt(env.TAGGING_THRESHOLD) ?? 10,
    timezone: env.TIMEZONE?.trim() || "America/Los_Angeles",
    allowDmCommands: (env.ALLOW_DM_COMMANDS ?? "true").trim().toLowerCase() !== "false",
    activeDays: days.length ? days : ALL_DAYS,
  };
}

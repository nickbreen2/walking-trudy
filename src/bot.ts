import { formatTime, localClock } from "./clock";
import type { Config } from "./config";
import {
  ALREADY_CAGED,
  CAGED,
  FED,
  HELP,
  POTTY_LOGGED,
  POTTY_QUESTION,
  escapeHtml,
  parsePotty,
  pottyFromCode,
  pottyLabel,
  slotMessage,
  type PottyCode,
} from "./messages";
import type { BotApi } from "./relay";
import { pickFromBag } from "./rotation";
import { SCHEDULE, dueSlots, type Slot } from "./schedule";
import type { Store, WalkRow } from "./store";
import type { CallbackQuery, Chat, InlineKeyboardButton, Message, Update, User } from "./types";

export interface Deps {
  store: Store;
  api: BotApi;
  config: Config;
  now: () => Date;
  random: () => number;
}

const BAG_KEY = "rotation_bag";
const LAST_ASSIGNEE_KEY = "last_assignee";

// ---------- helpers ----------

export function parseCommand(text: string): { name: string; args: string } | null {
  const m = /^\/([a-zA-Z_]+)(?:@[\w_]+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  return { name: m[1]!.toLowerCase(), args: (m[2] ?? "").trim() };
}

export function displayName(u: User | undefined): string {
  if (!u) return "someone";
  return u.first_name || (u.username ? "@" + u.username : "someone");
}

function today(d: Deps) {
  return localClock(d.now(), d.config.timezone);
}

/** Send to Trudy's group (and topic, if configured). */
async function announce(d: Deps, text: string, extra: Record<string, unknown> = {}) {
  if (d.config.groupChatId === null) {
    console.warn("GROUP_CHAT_ID not set; would have sent:", text);
    return null;
  }
  return d.api.call<Message>("sendMessage", {
    chat_id: d.config.groupChatId,
    message_thread_id: d.config.topicId ?? undefined,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

/** Reply in the chat (and topic) the message came from. */
async function replyTo(d: Deps, msg: Message, text: string) {
  return d.api.call<Message>("sendMessage", {
    chat_id: msg.chat.id,
    message_thread_id: msg.is_topic_message ? msg.message_thread_id : undefined,
    text,
    parse_mode: "HTML",
  });
}

function isTrudyChat(chat: Chat, c: Config): boolean {
  if (c.groupChatId !== null && chat.id === c.groupChatId) return true;
  return chat.type === "private" && c.allowDmCommands;
}

function pottyKeyboard(walkId: number): { inline_keyboard: InlineKeyboardButton[][] } {
  const btn = (text: string, code: PottyCode) => ({ text, callback_data: `potty:${walkId}:${code}` });
  return {
    inline_keyboard: [
      [btn("💧 Pee", "pee"), btn("💩 Poo", "poo")],
      [btn("💧💩 Both", "both"), btn("🙅 Neither", "none")],
    ],
  };
}

const asBool = (v: number | null) => (v === null ? null : v === 1);

// ---------- incoming updates ----------

export async function handleUpdate(update: Update, d: Deps): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query, d);

  const msg = update.message;
  if (!msg?.text) return;
  const cmd = parseCommand(msg.text);

  // /chatid works anywhere so you can find the group + topic ids during setup.
  if (cmd?.name === "chatid") {
    const lines = [`chat id: <code>${msg.chat.id}</code>`, `chat type: ${msg.chat.type}`];
    if (msg.message_thread_id) lines.push(`topic id: <code>${msg.message_thread_id}</code>`);
    await replyTo(d, msg, lines.join("\n"));
    return;
  }

  if (!isTrudyChat(msg.chat, d.config)) {
    console.log("Ignoring message from chat", msg.chat.id, msg.chat.type, "thread", msg.message_thread_id);
    return;
  }

  if (!cmd) {
    // A reply to "did I go pee or poo?" in plain text also works.
    if (msg.reply_to_message) await handlePottyReply(msg, d);
    return;
  }

  switch (cmd.name) {
    case "walked":
    case "walk":
      return handleWalked(msg, cmd.args, d);
    case "caged":
    case "crate":
    case "crated":
      return handleCaged(msg, d);
    case "fed":
    case "food":
    case "water":
      return handleFed(msg, d);
    case "status":
    case "today":
      await replyTo(d, msg, await statusText(d));
      return;
    case "help":
    case "start":
      await replyTo(d, msg, HELP);
      return;
    default:
      return;
  }
}

async function handleWalked(msg: Message, args: string, d: Deps) {
  const name = displayName(msg.from);
  const potty = parsePotty(args);
  const id = await d.store.addWalk({
    date: today(d).date,
    walkerName: name,
    walkerId: msg.from?.id ?? null,
    walkedAt: d.now().toISOString(),
    pee: potty?.pee ?? null,
    poo: potty?.poo ?? null,
  });

  if (potty) {
    await announce(d, POTTY_LOGGED(name, pottyLabel(potty.pee, potty.poo)));
    return;
  }
  const sent = await announce(d, POTTY_QUESTION(name), { reply_markup: pottyKeyboard(id) });
  if (sent) await d.store.setWalkPrompt(id, sent.message_id);
}

async function handlePottyReply(msg: Message, d: Deps) {
  const walk = await d.store.findWalkByPrompt(msg.reply_to_message!.message_id);
  const potty = parsePotty(msg.text);
  if (!walk || !potty) return;
  await d.store.setWalkPotty(walk.id, potty.pee, potty.poo);
  await announce(d, POTTY_LOGGED(walk.walker_name, pottyLabel(potty.pee, potty.poo)));
}

async function handleCallback(cq: CallbackQuery, d: Deps) {
  const m = /^potty:(\d+):(pee|poo|both|none)$/.exec(cq.data ?? "");
  if (!m) {
    await d.api.call("answerCallbackQuery", { callback_query_id: cq.id });
    return;
  }
  const walk = await d.store.getWalk(Number(m[1]));
  if (!walk) {
    await d.api.call("answerCallbackQuery", { callback_query_id: cq.id, text: "I can't find that walk 🤔" });
    return;
  }
  const { pee, poo } = pottyFromCode(m[2] as PottyCode);
  await d.store.setWalkPotty(walk.id, pee, poo);

  let text = POTTY_LOGGED(walk.walker_name, pottyLabel(pee, poo));
  const presser = displayName(cq.from);
  if (presser !== walk.walker_name) text += `\n<i>(reported by ${escapeHtml(presser)})</i>`;

  if (cq.message) {
    await d.api.call("editMessageText", {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      text,
      parse_mode: "HTML",
    });
  }
  await d.api.call("answerCallbackQuery", { callback_query_id: cq.id, text: "Logged! 🐾" });
}

async function handleCaged(msg: Message, d: Deps) {
  const { date } = today(d);
  const day = await d.store.getDay(date);
  if (day?.caged_at) {
    await announce(d, ALREADY_CAGED(day.caged_by ?? "someone"));
    return;
  }
  const name = displayName(msg.from);
  await d.store.updateDay(date, { caged_by: name, caged_at: d.now().toISOString() });
  await announce(d, CAGED(name));
}

async function handleFed(msg: Message, d: Deps) {
  const name = displayName(msg.from);
  await d.store.updateDay(today(d).date, { fed_by: name, fed_at: d.now().toISOString() });
  await announce(d, FED(name));
}

export async function statusText(d: Deps): Promise<string> {
  const { date } = today(d);
  const tz = d.config.timezone;
  const [day, walks] = await Promise.all([d.store.getDay(date), d.store.walksOn(date)]);
  const pretty = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(date + "T12:00:00Z"));

  const walkLines = walks.length
    ? walks.map(
        (w: WalkRow) =>
          `  • ${escapeHtml(w.walker_name)} at ${formatTime(w.walked_at, tz)} — ${pottyLabel(asBool(w.pee), asBool(w.poo))}`,
      )
    : ["  • none yet 🥺"];

  const lines = [
    `📋 <b>Trudy's day — ${pretty}</b>`,
    `🐾 Walks:`,
    ...walkLines,
    `🥣 Food &amp; water: ${day?.fed_at ? `checked by ${escapeHtml(day.fed_by ?? "someone")} at ${formatTime(day.fed_at, tz)}` : "not confirmed"}`,
    `💤 Crate: ${day?.caged_at ? `tucked in by ${escapeHtml(day.caged_by ?? "someone")} at ${formatTime(day.caged_at, tz)}` : "not yet"}`,
  ];
  if (day?.assignee) {
    lines.push(`🙋 On walk duty: ${escapeHtml(day.assignee)}${day.backup ? ` (backup ${escapeHtml(day.backup)})` : ""}`);
  }
  return lines.join("\n");
}

// ---------- scheduled messages ----------

async function nextWalker(d: Deps, avoid: string[]): Promise<string | null> {
  const bag = JSON.parse((await d.store.getMeta(BAG_KEY)) ?? "[]") as string[];
  const { pick, bag: rest } = pickFromBag(bag, d.config.walkers, d.random, avoid);
  await d.store.setMeta(BAG_KEY, JSON.stringify(rest));
  return pick;
}

async function conditionHolds(slot: Slot, date: string, d: Deps): Promise<boolean> {
  if (slot.when === "not_walked") return (await d.store.walksOn(date)).length === 0;
  if (slot.when === "not_caged") return !(await d.store.getDay(date))?.caged_at;
  return true;
}

/** Send one slot's message right now (assigning walkers as needed). */
export async function fireSlot(slot: Slot, date: string, d: Deps): Promise<void> {
  const day = await d.store.getDay(date);
  let assignee = day?.assignee ?? null;
  let backup = day?.backup ?? null;

  if (slot.id === "walk_ask" && !assignee) {
    const last = await d.store.getMeta(LAST_ASSIGNEE_KEY);
    assignee = await nextWalker(d, last ? [last] : []);
    if (assignee) {
      await d.store.updateDay(date, { assignee });
      await d.store.setMeta(LAST_ASSIGNEE_KEY, assignee);
    }
  }
  if (slot.id === "walk_desperate" && !backup && d.config.walkers.length > 1) {
    backup = await nextWalker(d, assignee ? [assignee] : []);
    if (backup) await d.store.updateDay(date, { backup });
  }

  await announce(d, slotMessage(slot.id, { assignee, backup }, d.random));
}

/** Called by the cron every 15 minutes. */
export async function runTick(d: Deps): Promise<string[]> {
  const clock = today(d);
  if (!d.config.activeDays.includes(clock.weekday)) return [];

  const fired: string[] = [];
  for (const slot of dueSlots(clock.hour, clock.minute, SCHEDULE)) {
    if (!(await conditionHolds(slot, clock.date, d))) continue;
    if (!(await d.store.claimSlot(clock.date, slot.id, d.now().toISOString()))) continue;
    try {
      await fireSlot(slot, clock.date, d);
      fired.push(slot.id);
    } catch (err) {
      // Let the next tick in this hour retry.
      await d.store.releaseSlot(clock.date, slot.id);
      console.error(`Slot ${slot.id} failed`, err);
    }
  }
  return fired;
}

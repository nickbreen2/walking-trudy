// Everything Trudy says. Each message has a few variants so she doesn't sound
// like a robot; one is picked at random. All text is sent with parse_mode=HTML.

import type { SlotId } from "./schedule";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function pickOne<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] ?? items[0]!;
}

export interface SlotContext {
  assignee: string | null; // "@username"
  backup: string | null;
}

const tag = (t: string | null) => (t ? escapeHtml(t) : "");

const SLOT_MESSAGES: Record<SlotId, (c: SlotContext) => string[]> = {
  walk_ask: (c) => {
    const who = c.assignee
      ? `${tag(c.assignee)}, you're my walker today! 🙏`
      : "Anyone? 🙏";
    return [
      `Good morning! 🐶☀️ Can someone walk me?\n${who}\n\nType /walked when we're back.`,
      `Rise and shine! 🐕 My legs are ready. Who's walking me?\n${who}\n\nType /walked when we're back.`,
      `Hey hey! 🐾 Walk time? Pretty please?\n${who}\n\nType /walked when we're back.`,
    ];
  },
  walk_nudge: (c) => [
    `Still waiting on my walk... 🥺 ${tag(c.assignee)}`.trim(),
    `Hellooo? Still no walk 👀🐶 ${tag(c.assignee)}`.trim(),
    `Just sitting by the door. Patiently. Mostly. 🚪🐕 ${tag(c.assignee)}`.trim(),
  ],
  walk_desperate: (c) => {
    const tags = [c.assignee, c.backup].filter(Boolean).map((t) => tag(t)).join(" ");
    return [
      `Getting more desperate here, I need to go to the bathroom 😰 ${tags}`.trim(),
      `Okay this is getting serious. Bathroom. Now. Please. 😣🚽 ${tags}`.trim(),
    ];
  },
  walk_sos: () => [
    `🚨 SOS 🚨 Still no walk and it's afternoon. Anyone in the office? My legs are crossed 🥴`,
    `🚨 Code yellow 🚨 It's been a whole morning. Whoever sees this first, please take me out! 🐶`,
  ],
  food_water_midday: () => [
    `Hey can someone make sure I have enough water and food to survive? 🥣💧`,
    `Quick bowl check? 🥣💧 A girl's gotta stay hydrated.`,
  ],
  food_water_evening: () => [
    `Evening bowl check! 🌇 Food and water topped up? 🥣💧`,
    `Is it dinner o'clock? 🍽️🐶 Someone check my food and water please!`,
  ],
  crate_ask: () => [
    `Can someone take me to my crate? I'm getting tired here 😴\nType /caged when I'm tucked in.`,
    `Yawn... 🥱 Bedtime. Who's tucking me in?\nType /caged when I'm in my crate.`,
  ],
  crate_nudge: () => [
    `Still up... 🥱🌙 Someone take me to my crate? /caged`,
    `It's past my bedtime 😪 Crate please! /caged`,
  ],
};

export function slotMessage(id: SlotId, ctx: SlotContext, random: () => number): string {
  return pickOne(SLOT_MESSAGES[id](ctx), random);
}

// ---------- Potty ----------

export type PottyCode = "pee" | "poo" | "both" | "none";

export function pottyFromCode(code: PottyCode): { pee: boolean; poo: boolean } {
  return { pee: code === "pee" || code === "both", poo: code === "poo" || code === "both" };
}

export function pottyLabel(pee: boolean | null, poo: boolean | null): string {
  if (pee === null && poo === null) return "❓ not reported";
  if (pee && poo) return "💧 pee + 💩 poo";
  if (pee) return "💧 pee";
  if (poo) return "💩 poo";
  return "🙅 nothing";
}

/** Parse free text like "both", "just pee", "💩", "#2", "neither". */
export function parsePotty(text: string | undefined): { pee: boolean; poo: boolean } | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\b(neither|nothing|none|nada)\b|🙅/.test(t)) return { pee: false, poo: false };
  if (/\bboth\b/.test(t)) return { pee: true, poo: true };
  const pee = /\b(pee+d?|wee+|piss(ed)?|number ?1)\b|#1|💧/.test(t);
  const poo = /\b(poo+p?(ed)?|poo+|number ?2|dump)\b|#2|💩/.test(t);
  if (!pee && !poo) return null;
  return { pee, poo };
}

export const POTTY_QUESTION = (name: string) =>
  `Thanks ${escapeHtml(name)}! 🐾 Did I go pee or poo? The people need to know.`;

export const POTTY_LOGGED = (name: string, label: string) =>
  `Thanks ${escapeHtml(name)}! 🐾 Walk logged: ${label}. The people have been informed. 🫡`;

export const CAGED = (name: string) =>
  `Thank you ${escapeHtml(name)}! 😴 Goodnight, see you all tomorrow ❤️`;

export const ALREADY_CAGED = (by: string) =>
  `I'm already tucked in (thanks ${escapeHtml(by)}) 💤`;

export const FED = (name: string) =>
  `Thanks ${escapeHtml(name)}! My bowls and I are grateful 🥣💧❤️`;

export const HELP = `🐶 <b>I'm Trudy!</b> Here's how to take care of me:

/walked — you walked me (I'll ask if I went pee or poo). Add it inline too: <code>/walked both</code>
/caged — I'm in my crate for the night
/fed — you checked my food and water
/status — what's happened today
/help — this message

I'll post at 7am asking for a walk and nudge at 9 and 11 if nobody's taken me out. Bedtime ask is at 10pm.`;

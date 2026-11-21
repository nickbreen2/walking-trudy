// Everything Trudy says. Each message has a few variants so she doesn't sound
// like a robot; one is picked at random. All text is sent with parse_mode=HTML.

import type { SlotKind } from "./schedule";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function pickOne<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] ?? items[0]!;
}

export interface WalkContext {
  isFirst: boolean; // 7am
  isLast: boolean; // 9pm last call
  walkedToday: boolean;
  hoursWaiting: number; // hours since the first reminder, if not walked today
  lastWalk: { name: string; time: string } | null; // today's most recent walk
  tags: string[]; // "@username"s to tag (empty until tagging is switched on)
}

const SIGN_OFF = "Type /walked when we're back.";

function walkLines(c: WalkContext): string[] {
  const last = c.lastWalk ? ` Last walk was ${escapeHtml(c.lastWalk.name)} at ${c.lastWalk.time}.` : "";
  if (c.isLast) {
    return c.walkedToday
      ? [
          `Last call for a walk tonight! 🌙🐾${last}`,
          `One more stroll before bed? 🌙 Last walk request of the day!${last}`,
        ]
      : [
          `Last call! 🌙 I haven't been out at all today and I really need to go 😰`,
          `🚨 Final walk request of the day 🚨 Nobody's taken me out yet! 🥺`,
        ];
  }
  if (c.walkedToday) {
    return [
      `Walk time again? 🐾${last}`,
      `Hey! Could someone take me out for a quick walk? 🐕${last}`,
      `Potty break please? 🌳🐶${last}`,
    ];
  }
  if (c.isFirst) {
    return [
      `Good morning! 🐶☀️ Can someone walk me?`,
      `Rise and shine! 🐕 My legs are ready. Who's walking me?`,
      `Hey hey! 🐾 Morning walk? Pretty please?`,
    ];
  }
  if (c.hoursWaiting <= 2) {
    return [
      `Still waiting on my walk... 🥺`,
      `Hellooo? Still no walk 👀🐶`,
      `Just sitting by the door. Patiently. Mostly. 🚪🐕`,
    ];
  }
  return [
    `Getting more desperate here, I need to go to the bathroom 😰`,
    `Okay this is getting serious. Bathroom. Please. 😣🚽`,
    `I've been holding it ALL day. Somebody? Anybody? 🥴`,
  ];
}

export function walkMessage(c: WalkContext, random: () => number): string {
  let text = pickOne(walkLines(c), random);
  if (c.tags.length) text += `\n${c.tags.map(escapeHtml).join(" ")} can you help? 🙏`;
  return `${text}\n\n${SIGN_OFF}`;
}

const OTHER: Record<Exclude<SlotKind, "walk">, string[]> = {
  food_water: [
    `Hey can someone make sure I have enough water and food to survive? 🥣💧`,
    `Quick bowl check? 🥣💧 A girl's gotta stay hydrated.`,
    `Is my water bowl full? Asking for a thirsty corgi 💧🐶`,
  ],
  crate_ask: [
    `Can someone take me to my crate? I'm getting tired here 😴\nType /caged when I'm tucked in.`,
    `Yawn... 🥱 Bedtime. Who's tucking me in?\nType /caged when I'm in my crate.`,
  ],
  crate_nudge: [`Still up... 🥱🌙 Someone take me to my crate? /caged`, `It's past my bedtime 😪 Crate please! /caged`],
};

export function otherMessage(kind: Exclude<SlotKind, "walk">, random: () => number): string {
  return pickOne(OTHER[kind], random);
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

export const TAGGING_ON = (n: number) =>
  `🎉 ${n} different people have walked me! From now on I'll tag one of my walkers when I need to go out.\nDon't want to be tagged? Send /leave (and /join to come back).`;

export const JOINED = (name: string) =>
  `Yay ${escapeHtml(name)}! 🐾 You're on my walk crew. Once tagging is on, I may tag you when I need to go out. Send /leave to stop.`;
export const LEFT = (name: string) => `Got it ${escapeHtml(name)}, I won't tag you. 🤐 Send /join if you change your mind.`;

export const HELP = `🐶 <b>I'm Trudy!</b> Here's how to take care of me:

/walked — you walked me (I'll ask if I went pee or poo). Add it inline too: <code>/walked both</code>
/caged — I'm in my crate for the night
/fed — you checked my food and water
/status — what's happened today
/join — ok to tag me for walks · /leave — never tag me
/help — this message

I ask for a walk every 2 hours from 7am to 9pm (I skip it if I was walked in the last 2 hours). Bedtime ask is at 10pm.
I don't tag anyone until 10 different people have walked me, and then only people who have used /walked or /join.`;

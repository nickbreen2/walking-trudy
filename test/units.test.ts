import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/bot";
import { localClock } from "../src/clock";
import { parseWalkers } from "../src/config";
import { parsePotty } from "../src/messages";
import { pickFromBag } from "../src/rotation";
import { dueSlots } from "../src/schedule";

const TZ = "America/Los_Angeles";

describe("localClock", () => {
  it("handles PDT (summer): 14:00Z is 7am", () => {
    const c = localClock(new Date("2026-07-01T14:00:00Z"), TZ);
    expect(c).toMatchObject({ date: "2026-07-01", hour: 7, weekday: "Wed" });
  });
  it("handles PST (winter): 15:00Z is 7am", () => {
    const c = localClock(new Date("2026-12-01T15:00:00Z"), TZ);
    expect(c).toMatchObject({ date: "2026-12-01", hour: 7 });
  });
  it("counts 12:30am as the previous Trudy day", () => {
    const c = localClock(new Date("2026-12-02T08:30:00Z"), TZ); // 00:30 PST Dec 2
    expect(c).toMatchObject({ date: "2026-12-01", hour: 0 });
  });
});

describe("parseCommand", () => {
  it("parses plain and @bot commands", () => {
    expect(parseCommand("/walked")).toEqual({ name: "walked", args: "" });
    expect(parseCommand("/Walked@walking_trudy_bot both")).toEqual({ name: "walked", args: "both" });
    expect(parseCommand("hello")).toBeNull();
  });
});

describe("parsePotty", () => {
  it.each([
    ["pee", { pee: true, poo: false }],
    ["she pooped!", { pee: false, poo: true }],
    ["both", { pee: true, poo: true }],
    ["💧💩", { pee: true, poo: true }],
    ["#2", { pee: false, poo: true }],
    ["neither", { pee: false, poo: false }],
  ])("%s", (input, expected) => expect(parsePotty(input)).toEqual(expected));
  it("returns null for unrelated text", () => expect(parsePotty("great walk")).toBeNull());
});

describe("parseWalkers", () => {
  it("normalizes and dedupes", () => {
    expect(parseWalkers("nick, @andres @@matt,nick")).toEqual(["@nick", "@andres", "@matt"]);
  });
});

describe("rotation", () => {
  it("picks everyone once before repeating, never back to back", () => {
    const walkers = ["@a", "@b", "@c", "@d"];
    let bag: string[] = [];
    let last: string | null = null;
    const picks: string[] = [];
    let s = 1;
    const rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);
    for (let i = 0; i < 40; i++) {
      const r = pickFromBag(bag, walkers, rnd, last ? [last] : []);
      expect(r.pick).not.toBe(last);
      picks.push(r.pick!);
      bag = r.bag;
      last = r.pick;
    }
    for (let i = 0; i < 40; i += 4) {
      expect(new Set(picks.slice(i, i + 4)).size).toBe(4);
    }
  });
  it("handles a single walker", () => {
    expect(pickFromBag([], ["@solo"], Math.random, ["@solo"]).pick).toBe("@solo");
  });
  it("handles no walkers", () => {
    expect(pickFromBag([], [], Math.random).pick).toBeNull();
  });
});

describe("dueSlots", () => {
  it("returns the 7am ask at 7:00 and 7:45", () => {
    expect(dueSlots(7, 0).map((s) => s.id)).toEqual(["walk_ask"]);
    expect(dueSlots(7, 45).map((s) => s.id)).toEqual(["walk_ask"]);
    expect(dueSlots(8, 0)).toEqual([]);
  });
});

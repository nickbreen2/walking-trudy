import { describe, expect, it, vi } from "vitest";
import { handleUpdate, runTick } from "../src/bot";
import { GROUP, groupMessage, makeTestDeps, person } from "./helpers";

// 2026-12-01 is PST (UTC-8): local hour H = (H+8):00Z. 9pm = 05:00Z next day.
const at = (localHour: number, minute = 0) => {
  const d = new Date(Date.UTC(2026, 11, 1, localHour + 8, minute));
  return d.toISOString();
};

async function walkBy(deps: Parameters<typeof handleUpdate>[1], i: number, text = "/walked pee") {
  await handleUpdate(groupMessage(text, { from: person(i) }), deps);
}

describe("walk reminders", () => {
  it("every 2 hours from 7am to 9pm when nobody walks her, each once", async () => {
    const { deps, setNow } = makeTestDeps({ now: at(6) });
    const fired: string[] = [];
    for (let h = 6; h <= 23; h++) {
      for (const m of [0, 15, 30, 45]) {
        setNow(at(h, m));
        fired.push(...(await runTick(deps)));
      }
    }
    expect(fired.filter((f) => f.startsWith("walk_"))).toEqual([
      "walk_07", "walk_09", "walk_11", "walk_13", "walk_15", "walk_17", "walk_19", "walk_21",
    ]);
    expect(fired).toContain("food_water_12");
    expect(fired).toContain("crate_ask");
  });

  it("escalates the wording while she's waiting", async () => {
    const { deps, api, setNow } = makeTestDeps({ now: at(7) });
    await runTick(deps);
    expect(api.sent().at(-1)).toMatch(/walk/i);
    setNow(at(11));
    await runTick(deps);
    expect(api.sent().at(-1)).toMatch(/desperate|serious|holding/i);
  });

  it("skips a reminder if she was walked in the last 2 hours", async () => {
    const { deps, api, setNow } = makeTestDeps({ now: at(7) });
    await runTick(deps);
    setNow(at(8, 10));
    await walkBy(deps, 1);
    setNow(at(9));
    expect(await runTick(deps)).toEqual([]);
    setNow(at(11)); // 2h50m since the walk
    expect(await runTick(deps)).toEqual(["walk_11"]);
    expect(api.sent().at(-1)).toContain("Last walk was Person1 at 8:10 AM");
  });

  it("does not tag anyone before 10 different people have walked her", async () => {
    const { deps, api } = makeTestDeps({ now: at(7) });
    await runTick(deps);
    expect(api.sent().at(-1)).not.toContain("@");
  });
});

describe("consent-based tagging", () => {
  it("switches on at the 10th different walker, announces it once, and tags only walkers", async () => {
    const { deps, api, setNow } = makeTestDeps({ now: at(6) });
    for (let i = 1; i <= 9; i++) await walkBy(deps, i);
    await walkBy(deps, 1); // repeat walker doesn't count twice
    expect(api.sent().some((t) => t.includes("different people have walked me"))).toBe(false);

    await walkBy(deps, 10);
    const announcements = api.sent().filter((t) => t.includes("10 different people have walked me"));
    expect(announcements).toHaveLength(1);
    await walkBy(deps, 11);
    expect(api.sent().filter((t) => t.includes("different people have walked me"))).toHaveLength(1);

    setNow(at(9)); // > 2h after the walks at 6am
    await runTick(deps);
    const msg = api.sent().at(-1)!;
    const tags = msg.match(/@\w+/g) ?? [];
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatch(/^@person(\d+)$/);
  });

  it("/leave removes someone from tagging and /join adds them back", async () => {
    const { deps, store } = makeTestDeps({ now: at(6), threshold: 2 });
    await walkBy(deps, 1);
    await walkBy(deps, 2);
    expect(await store.taggableWalkers()).toEqual(["@person1", "@person2"]);
    await handleUpdate(groupMessage("/leave", { from: person(1) }), deps);
    expect(await store.taggableWalkers()).toEqual(["@person2"]);
    await handleUpdate(groupMessage("/join", { from: person(1) }), deps);
    expect(await store.taggableWalkers()).toContain("@person1");
  });

  it("/join lets someone be tagged without walking, but doesn't count toward the 10", async () => {
    const { deps, store } = makeTestDeps({ now: at(6), threshold: 2 });
    await handleUpdate(groupMessage("/join", { from: person(7) }), deps);
    expect(await store.walkerCount()).toBe(0);
    expect(await store.taggableWalkers()).toEqual(["@person7"]);
  });

  it("someone who sends /leave before ever walking is never counted or tagged", async () => {
    const { deps, store } = makeTestDeps({ now: at(6), threshold: 2 });
    await handleUpdate(groupMessage("/leave", { from: person(5) }), deps);
    expect(await store.walkerCount()).toBe(0);
    await walkBy(deps, 5);
    expect(await store.walkerCount()).toBe(1);
    expect(await store.taggableWalkers()).toEqual([]);
  });

  it("rotates tags fairly and never tags the same person twice in a row", async () => {
    const { deps, api, setNow } = makeTestDeps({ now: at(5), threshold: 3 });
    for (let i = 1; i <= 3; i++) await walkBy(deps, i);
    const tagged: string[] = [];
    for (const h of [7, 9, 11, 13, 15, 17]) {
      setNow(at(h));
      await runTick(deps);
      tagged.push(api.sent().at(-1)!.match(/@\w+/)![0]);
    }
    for (let i = 1; i < tagged.length; i++) expect(tagged[i]).not.toBe(tagged[i - 1]);
    expect(new Set(tagged.slice(0, 3)).size).toBe(3);
  });
});

describe("/walked", () => {
  it("asks pee or poo with buttons and logs the tap", async () => {
    const { deps, api, store } = makeTestDeps({ now: at(8, 14) });
    await handleUpdate(groupMessage("/walked"), deps);
    const q = api.calls.find((c) => c.method === "sendMessage")!;
    expect(q.body).toMatchObject({ chat_id: GROUP, message_thread_id: 7, parse_mode: "HTML" });
    expect(q.body.text).toContain("Thanks Nick");
    expect(q.body.text).toContain("pee or poo");
    const kb = q.body.reply_markup as { inline_keyboard: { callback_data: string }[][] };
    expect(kb.inline_keyboard.flat().map((b) => b.callback_data)).toContain("potty:1:both");

    await handleUpdate(
      {
        update_id: 2,
        callback_query: {
          id: "cb1",
          from: { id: 555, first_name: "Nick" },
          data: "potty:1:both",
          message: { message_id: 100, chat: { id: GROUP, type: "supergroup" }, date: 0 },
        },
      },
      deps,
    );
    expect((await store.walksOn("2026-12-01"))[0]).toMatchObject({ pee: 1, poo: 1 });
    // Relay keeps the keyboard on a text edit, so both calls must clear the buttons.
    const edit = api.calls.find((c) => c.method === "editMessageText")!;
    expect(edit.body).toMatchObject({ chat_id: GROUP, message_id: 100, reply_markup: { inline_keyboard: [] } });
    const markup = api.calls.find((c) => c.method === "editMessageReplyMarkup")!;
    expect(markup.body).toEqual({ chat_id: GROUP, message_id: 100, reply_markup: { inline_keyboard: [] } });
    expect(api.calls.indexOf(markup)).toBe(api.calls.indexOf(edit) + 1);
    expect(api.calls.at(-1)!.method).toBe("answerCallbackQuery");
  });

  it("still logs the tap when the buttons are already gone", async () => {
    const { deps, api, store } = makeTestDeps({ now: at(8, 14) });
    await handleUpdate(groupMessage("/walked"), deps);
    api.failures.editMessageReplyMarkup = "Bad Request: message is not modified";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleUpdate(
      {
        update_id: 2,
        callback_query: {
          id: "cb1",
          from: { id: 555, first_name: "Nick" },
          data: "potty:1:pee",
          message: { message_id: 100, chat: { id: GROUP, type: "supergroup" }, date: 0 },
        },
      },
      deps,
    );
    expect(errors).toHaveBeenCalledOnce();
    errors.mockRestore();
    expect((await store.walksOn("2026-12-01"))[0]).toMatchObject({ pee: 1, poo: 0 });
    expect(api.calls.at(-1)).toMatchObject({ method: "answerCallbackQuery", body: { text: "Logged! 🐾" } });
  });

  it("accepts the answer inline and as a text reply", async () => {
    const { deps, api, store } = makeTestDeps({ now: at(8) });
    await handleUpdate(groupMessage("/walked pee"), deps);
    expect(api.sent().at(-1)).toContain("💧 pee");

    await handleUpdate(groupMessage("/walked"), deps);
    const walk = (await store.walksOn("2026-12-01"))[1]!;
    await handleUpdate(
      groupMessage("just poo", {
        reply_to_message: { message_id: walk.prompt_message_id, chat: { id: GROUP, type: "supergroup" }, date: 0 },
      }),
      deps,
    );
    expect((await store.walksOn("2026-12-01"))[1]).toMatchObject({ pee: 0, poo: 1 });
    // The buttons on the original prompt are cleared too.
    const markup = api.calls.find((c) => c.method === "editMessageReplyMarkup")!;
    expect(markup.body).toEqual({
      chat_id: GROUP,
      message_id: walk.prompt_message_id,
      reply_markup: { inline_keyboard: [] },
    });
  });

  it("stores the walker's username", async () => {
    const { deps, store } = makeTestDeps({ now: at(8), threshold: 1 });
    await handleUpdate(groupMessage("/walked"), deps);
    expect(await store.taggableWalkers()).toEqual(["@nick"]);
  });
});

describe("night crate flow", () => {
  it("sends one bedtime ask at 10pm and no 11pm follow-up, even if nobody /caged", async () => {
    const { deps, api, setNow } = makeTestDeps({ now: at(22) });
    expect(await runTick(deps)).toEqual(["crate_ask"]);
    expect(api.sent().at(-1)).toMatch(/\/caged/);
    for (const m of [0, 15, 30, 45]) {
      setNow(at(23, m));
      expect(await runTick(deps)).toEqual([]);
    }
    expect(api.sent()).toHaveLength(1);
  });

  it("asks at 10pm, /caged thanks, and the 11pm nudge is skipped", async () => {
    const { deps, api, setNow } = makeTestDeps({ now: at(22) });
    expect(await runTick(deps)).toEqual(["crate_ask"]);
    await handleUpdate(groupMessage("/caged"), deps);
    expect(api.sent().at(-1)).toMatch(/see you all tomorrow ❤️/);
    setNow(at(23));
    expect(await runTick(deps)).toEqual([]);
    await handleUpdate(groupMessage("/caged"), deps);
    expect(api.sent().at(-1)).toMatch(/already tucked in/);
  });
});

describe("security", () => {
  it("ignores commands from other groups", async () => {
    const { deps, api } = makeTestDeps({ now: at(8) });
    await handleUpdate(groupMessage("/walked", { chat: { id: -999, type: "group" } }), deps);
    expect(api.calls).toEqual([]);
  });
  it("/chatid works anywhere", async () => {
    const { deps, api } = makeTestDeps({ now: at(8) });
    await handleUpdate(groupMessage("/chatid", { chat: { id: -999, type: "group" } }), deps);
    expect(api.sent()[0]).toContain("-999");
  });
});

describe("/status", () => {
  it("summarizes the day and tagging progress", async () => {
    const { deps, api } = makeTestDeps({ now: at(8, 14) });
    await handleUpdate(groupMessage("/walked both"), deps);
    await handleUpdate(groupMessage("/status"), deps);
    const s = api.sent().at(-1)!;
    expect(s).toContain("Nick at 8:14 AM");
    expect(s).toContain("💧 pee + 💩 poo");
    expect(s).toContain("Tagging: off until 10 people have walked me (1 so far)");
  });
});

describe("DOG_NAME", () => {
  it("uses the configured dog's name in /help and /status", async () => {
    const { deps, api } = makeTestDeps({ now: at(8) });
    deps.config.dogName = "Biscuit";
    await handleUpdate(groupMessage("/help"), deps);
    expect(api.sent().at(-1)).toContain("I'm Biscuit!");
    await handleUpdate(groupMessage("/status"), deps);
    expect(api.sent().at(-1)).toContain("Biscuit's day");
  });
});

// Pacific local time on any date. offset = 8 (PST) or 7 (PDT).
const atOn = (date: string, h: number, m = 0, offset = 8) => {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, h + offset, m)).toISOString();
};

describe("scoreboards", () => {
  async function walkAt(t: ReturnType<typeof makeTestDeps>, iso: string, i: number) {
    t.setNow(iso);
    await handleUpdate(groupMessage("/walked pee", { from: person(i) }), t.deps);
  }

  it("posts the weekly scoreboard and a thank-you on Sunday at 8:30pm, naming everyone tied for first", async () => {
    const t = makeTestDeps({ now: atOn("2026-11-16", 8) });
    // Mon–Sun Nov 16–22: person1 x3, person2 x3, person3 x1. A walk the Sunday before doesn't count.
    await walkAt(t, atOn("2026-11-15", 9), 3);
    for (const [day, who] of [["16", 1], ["17", 1], ["18", 2], ["19", 2], ["20", 1], ["21", 2], ["22", 3]] as const) {
      await walkAt(t, atOn(`2026-11-${day}`, 10), who);
    }
    const before = t.api.sent().length;

    t.setNow(atOn("2026-11-22", 20, 15));
    expect(await runTick(t.deps)).toEqual([]);
    t.setNow(atOn("2026-11-22", 20, 30));
    expect(await runTick(t.deps)).toEqual(["weekly_scoreboard"]);
    t.setNow(atOn("2026-11-22", 20, 45));
    expect(await runTick(t.deps)).toEqual([]);

    const [board, thanks, ...rest] = t.api.sent().slice(before);
    expect(rest).toEqual([]);
    expect(board).toContain("Trudy's Weekly Walk Scoreboard");
    expect(board).toContain("Nov 16 – Nov 22");
    expect(board).toContain("🥇 Person1 — 3 walks");
    expect(board).toContain("🥇 Person2 — 3 walks");
    expect(board).toContain("🥉 Person3 — 1 walk");
    expect(board).toContain("7 walks from 3 people");
    expect(board).not.toContain("@");
    expect(thanks).toMatch(/Person1 and Person2/);
    expect(thanks).toMatch(/❤️/);
    expect(thanks).not.toContain("Person3");
  });

  it("does not post the weekly scoreboard on other days", async () => {
    const t = makeTestDeps({ now: atOn("2026-11-21", 20, 30) }); // Saturday
    expect(await runTick(t.deps)).toEqual([]);
  });

  it("posts only the scoreboard (no thank-you) when nobody walked", async () => {
    const t = makeTestDeps({ now: atOn("2026-11-22", 20, 30) });
    expect(await runTick(t.deps)).toEqual(["weekly_scoreboard"]);
    expect(t.api.sent()).toHaveLength(1);
    expect(t.api.sent()[0]).toContain("No walks logged this week");
  });

  it("posts the monthly scoreboard and a separate love note on the last day of the month", async () => {
    const t = makeTestDeps({ now: atOn("2026-11-02", 8) });
    await walkAt(t, atOn("2026-10-31", 9), 2); // October doesn't count
    await walkAt(t, atOn("2026-11-02", 9), 1);
    await walkAt(t, atOn("2026-11-12", 9), 1);
    await walkAt(t, atOn("2026-11-29", 9), 2);
    const before = t.api.sent().length;

    t.setNow(atOn("2026-11-29", 20, 30)); // a Sunday, not the last day: weekly only
    expect(await runTick(t.deps)).toEqual(["weekly_scoreboard"]);
    t.setNow(atOn("2026-11-30", 20, 30)); // Monday Nov 30
    expect(await runTick(t.deps)).toEqual(["monthly_scoreboard"]);

    const [board, love] = t.api.sent().slice(before + 2);
    expect(board).toContain("Trudy's Monthly Walk Scoreboard");
    expect(board).toContain("November 2026");
    expect(board).toContain("🥇 Person1 — 2 walks");
    expect(board).toContain("🥈 Person2 — 1 walk");
    expect(love).toMatch(/Person1/);
    expect(love).toMatch(/November/);
  });

  it("posts weekly then monthly when the last day of the month is a Sunday", async () => {
    const t = makeTestDeps({ now: atOn("2026-05-31", 20, 30, 7) });
    expect(await runTick(t.deps)).toEqual(["weekly_scoreboard", "monthly_scoreboard"]);
  });

  it("still posts scoreboards when ACTIVE_DAYS excludes Sunday", async () => {
    const t = makeTestDeps({ now: atOn("2026-11-22", 20, 30) });
    t.deps.config.activeDays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    expect(await runTick(t.deps)).toEqual(["weekly_scoreboard"]);
    t.setNow(atOn("2026-11-22", 21));
    expect(await runTick(t.deps)).toEqual([]); // the 9pm walk reminder respects ACTIVE_DAYS
  });

  it("/daily_walks, /weekly_walks and /monthly_walks reply with the scoreboard and no thank-you", async () => {
    const t = makeTestDeps({ now: atOn("2026-11-20", 9) });
    await walkAt(t, atOn("2026-11-20", 9), 1);
    await walkAt(t, atOn("2026-11-22", 9), 2);
    await walkAt(t, atOn("2026-11-22", 11, 30), 2);

    for (const [cmd, expected] of [
      ["/daily_walks", ["Walks Today", "Person2 — 2 walks"]],
      ["/weekly_walks", ["Weekly Walk Scoreboard", "🥇 Person2 — 2 walks", "🥈 Person1 — 1 walk"]],
      ["/monthly_walks@walking_trudy_bot", ["Monthly Walk Scoreboard", "November 2026"]],
    ] as const) {
      const before = t.api.sent().length;
      await handleUpdate(groupMessage(cmd), t.deps);
      const replies = t.api.sent().slice(before);
      expect(replies).toHaveLength(1);
      for (const e of expected) expect(replies[0]).toContain(e);
    }
    const daily = t.api.sent().at(-3)!;
    expect(daily).not.toContain("Person1");
  });
});

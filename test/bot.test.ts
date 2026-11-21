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

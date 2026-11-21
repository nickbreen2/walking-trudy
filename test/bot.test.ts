import { describe, expect, it } from "vitest";
import { handleUpdate, runTick } from "../src/bot";
import { GROUP, groupMessage, makeTestDeps } from "./helpers";

// 2026-12-01 is PST (UTC-8): 7am = 15:00Z, 9am = 17:00Z, 11am = 19:00Z, 10pm = 06:00Z next day.

describe("morning walk flow", () => {
  it("asks at 7am, tags someone, and only once", async () => {
    const { deps, api, store, setNow } = makeTestDeps({ now: "2026-12-01T15:00:00Z" });
    expect(await runTick(deps)).toEqual(["walk_ask"]);
    setNow("2026-12-01T15:15:00Z");
    expect(await runTick(deps)).toEqual([]);

    const [text] = api.sent();
    expect(text).toMatch(/walk/i);
    const day = await store.getDay("2026-12-01");
    expect(day?.assignee).toMatch(/^@/);
    expect(text).toContain(day!.assignee!);
    expect(api.calls[0]!.body).toMatchObject({ chat_id: GROUP, message_thread_id: 7, parse_mode: "HTML" });
  });

  it("nudges at 9 and escalates at 11 with a different backup when nobody walked", async () => {
    const { deps, api, store, setNow } = makeTestDeps({ now: "2026-12-01T15:00:00Z" });
    await runTick(deps);
    setNow("2026-12-01T17:00:00Z");
    expect(await runTick(deps)).toEqual(["walk_nudge"]);
    setNow("2026-12-01T19:00:00Z");
    expect(await runTick(deps)).toEqual(["walk_desperate"]);

    const day = (await store.getDay("2026-12-01"))!;
    expect(day.backup).toBeTruthy();
    expect(day.backup).not.toBe(day.assignee);
    const last = api.sent().at(-1)!;
    expect(last).toContain(day.assignee!);
    expect(last).toContain(day.backup!);
  });

  it("stops nudging once /walked is used, and asks pee or poo with buttons", async () => {
    const { deps, api, store, setNow } = makeTestDeps({ now: "2026-12-01T15:00:00Z" });
    await runTick(deps);
    setNow("2026-12-01T16:10:00Z");
    await handleUpdate(groupMessage("/walked"), deps);

    const q = api.calls.at(-1)!;
    expect(q.body.text).toContain("Thanks Nick");
    expect(q.body.text).toContain("pee or poo");
    const kb = q.body.reply_markup as { inline_keyboard: { callback_data: string }[][] };
    expect(kb.inline_keyboard.flat().map((b) => b.callback_data)).toContain("potty:1:both");

    setNow("2026-12-01T17:00:00Z");
    expect(await runTick(deps)).toEqual([]);
    setNow("2026-12-01T19:00:00Z");
    expect(await runTick(deps)).toEqual([]);

    // Someone taps "Both"
    await handleUpdate(
      {
        update_id: 2,
        callback_query: {
          id: "cb1",
          from: { id: 555, first_name: "Nick" },
          data: "potty:1:both",
          message: { message_id: 101, chat: { id: GROUP, type: "supergroup" }, date: 0 },
        },
      },
      deps,
    );
    const walk = (await store.walksOn("2026-12-01"))[0]!;
    expect([walk.pee, walk.poo]).toEqual([1, 1]);
    expect(api.calls.some((c) => c.method === "editMessageText")).toBe(true);
    expect(api.calls.at(-1)!.method).toBe("answerCallbackQuery");
  });

  it("accepts /walked with the answer inline", async () => {
    const { deps, api, store } = makeTestDeps({ now: "2026-12-01T16:00:00Z" });
    await handleUpdate(groupMessage("/walked pee"), deps);
    expect(api.sent().at(-1)).toContain("💧 pee");
    expect((await store.walksOn("2026-12-01"))[0]).toMatchObject({ pee: 1, poo: 0 });
  });

  it("accepts a text reply to the pee/poo question", async () => {
    const { deps, store } = makeTestDeps({ now: "2026-12-01T16:00:00Z" });
    await handleUpdate(groupMessage("/walked"), deps);
    const walk = (await store.walksOn("2026-12-01"))[0]!;
    await handleUpdate(
      groupMessage("just poo", { reply_to_message: { message_id: walk.prompt_message_id, chat: { id: GROUP, type: "supergroup" }, date: 0 } }),
      deps,
    );
    expect((await store.walksOn("2026-12-01"))[0]).toMatchObject({ pee: 0, poo: 1 });
  });
});

describe("night crate flow", () => {
  it("asks at 10pm, /caged thanks, and the 11pm nudge is skipped", async () => {
    const { deps, api, setNow } = makeTestDeps({ now: "2026-12-02T06:00:00Z" }); // 10pm Dec 1
    expect(await runTick(deps)).toEqual(["crate_ask"]);
    await handleUpdate(groupMessage("/caged"), deps);
    expect(api.sent().at(-1)).toMatch(/see you all tomorrow ❤️/);
    setNow("2026-12-02T07:00:00Z");
    expect(await runTick(deps)).toEqual([]);
    await handleUpdate(groupMessage("/caged"), deps);
    expect(api.sent().at(-1)).toMatch(/already tucked in/);
  });
});

describe("security", () => {
  it("ignores commands from other groups", async () => {
    const { deps, api } = makeTestDeps({ now: "2026-12-01T16:00:00Z" });
    await handleUpdate(groupMessage("/walked", { chat: { id: -999, type: "group" } }), deps);
    expect(api.calls).toEqual([]);
  });
  it("/chatid works anywhere", async () => {
    const { deps, api } = makeTestDeps({ now: "2026-12-01T16:00:00Z" });
    await handleUpdate(groupMessage("/chatid", { chat: { id: -999, type: "group" } }), deps);
    expect(api.sent()[0]).toContain("-999");
  });
});

describe("/status", () => {
  it("summarizes the day", async () => {
    const { deps, api } = makeTestDeps({ now: "2026-12-01T16:14:00Z" });
    await handleUpdate(groupMessage("/walked both"), deps);
    await handleUpdate(groupMessage("/status"), deps);
    const s = api.sent().at(-1)!;
    expect(s).toContain("Nick at 8:14 AM");
    expect(s).toContain("💧 pee + 💩 poo");
  });
});

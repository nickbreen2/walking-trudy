import type { Deps } from "../src/bot";
import { loadConfig } from "../src/config";
import { BotApiError, type BotApi } from "../src/relay";
import { MemoryStore } from "../src/store";

export class FakeApi implements BotApi {
  calls: { method: string; body: Record<string, unknown> }[] = [];
  private nextId = 100;
  /** Methods that should fail like Relay would, e.g. { editMessageReplyMarkup: "message is not modified" }. */
  failures: Record<string, string> = {};
  async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, body });
    if (this.failures[method]) throw new BotApiError(method, 400, this.failures[method]);
    if (method === "sendMessage") return { message_id: this.nextId++ } as T;
    return true as T;
  }
  sent() {
    return this.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.body.text));
  }
}

export const GROUP = -100123;

export function makeTestDeps(opts: { now: string; threshold?: number }) {
  const store = new MemoryStore();
  const api = new FakeApi();
  let now = new Date(opts.now);
  let seed = 42;
  const deps: Deps = {
    store,
    api,
    config: loadConfig({
      GROUP_CHAT_ID: String(GROUP),
      TOPIC_ID: "7",
      TAGGING_THRESHOLD: String(opts.threshold ?? 10),
      TIMEZONE: "America/Los_Angeles",
    }),
    now: () => now,
    random: () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    },
  };
  return { deps, store, api, setNow: (iso: string) => (now = new Date(iso)) };
}

export function person(i: number) {
  return { id: 1000 + i, first_name: `Person${i}`, username: `person${i}` };
}

export function groupMessage(text: string, extra: Record<string, unknown> = {}) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: GROUP, type: "supergroup" as const },
      from: { id: 555, first_name: "Nick", username: "nick" },
      date: 0,
      text,
      ...extra,
    },
  };
}

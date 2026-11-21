import { fireSlot, handleUpdate, runTick, type Deps } from "./bot";
import { localClock } from "./clock";
import { loadConfig, type Env } from "./config";
import { RelayClient } from "./relay";
import { findSlot } from "./schedule";
import { D1Store } from "./store";
import type { Update } from "./types";

export const botCommands = (dog: string) => [
  { command: "walked", description: `I walked ${dog}` },
  { command: "caged", description: `${dog} is in the crate for the night` },
  { command: "fed", description: `I checked ${dog}'s food and water` },
  { command: "status", description: "What happened today" },
  { command: "join", description: `OK to tag me when ${dog} needs a walk` },
  { command: "leave", description: "Never tag me for walks" },
  { command: "help", description: `How ${dog} works` },
];

function makeDeps(env: Env): Deps {
  return {
    store: new D1Store(env.DB),
    api: new RelayClient(env.TELEGRAM_API_URL, env.TELEGRAM_BOT_TOKEN),
    config: loadConfig(env),
    now: () => new Date(),
    random: Math.random,
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Constant-time string compare for secrets. */
function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleAdmin(req: Request, env: Env, url: URL): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth.replace(/^Bearer\s+/i, ""), env.ADMIN_SECRET ?? "")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const d = makeDeps(env);

  switch (url.pathname) {
    // Registers the webhook + command menu with Relay. Run once after deploy.
    case "/admin/setup": {
      const me = await d.api.call("getMe");
      await d.api.call("setWebhook", {
        url: `${url.origin}/webhook`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
      });
      await d.api.call("setMyCommands", { commands: botCommands(d.config.dogName) });
      const info = await d.api.call("getWebhookInfo");
      return json({ ok: true, me, webhook: info });
    }
    // Force-send a scheduled message now, e.g. /admin/fire?slot=walk_ask
    case "/admin/fire": {
      const slot = findSlot(url.searchParams.get("slot") ?? "");
      if (!slot) return json({ ok: false, error: "unknown slot" }, 400);
      const { date } = localClock(d.now(), d.config.timezone);
      await fireSlot(slot, date, d);
      return json({ ok: true, fired: slot.id, date });
    }
    // Run the scheduler logic as if the cron just ticked.
    case "/admin/tick":
      return json({ ok: true, fired: await runTick(d) });
    case "/admin/config":
      return json({ ok: true, config: d.config, clock: localClock(d.now(), d.config.timezone) });
    default:
      return json({ ok: false, error: "not found" }, 404);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/webhook" && req.method === "POST") {
      const secret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
      if (!safeEqual(secret, env.WEBHOOK_SECRET ?? "")) return new Response("forbidden", { status: 403 });
      try {
        const update = (await req.json()) as Update;
        await handleUpdate(update, makeDeps(env));
      } catch (err) {
        // Always 200 so Relay doesn't keep redelivering a bad update.
        console.error("update failed", err);
      }
      return new Response("ok");
    }

    if (url.pathname.startsWith("/admin/") && req.method === "POST") {
      try {
        return await handleAdmin(req, env, url);
      } catch (err) {
        return json({ ok: false, error: String(err) }, 500);
      }
    }

    if (url.pathname === "/") return new Response(`${loadConfig(env).dogName} is awake 🐶`);
    return new Response("not found", { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runTick(makeDeps(env)).then((fired) => {
        if (fired.length) console.log("fired", fired);
      }),
    );
  },
} satisfies ExportedHandler<Env>;

# walking_trudy 🐶

Trudy is the Corgi SF office dog. This bot lives in her Corgi Relay chat. It asks for walks, tags a random person each morning, logs pee and poo, reminds people about food and water, and asks for her crate at night.

It runs on **Cloudflare Workers (free tier)** and stores state in **Cloudflare D1** (free SQLite). Corgi Relay speaks the Telegram Bot API, so the bot calls `https://d1hbrzkrx7d3gv.cloudfront.net/bot<TOKEN>/<method>` instead of Telegram.

## How Trudy's day works (Pacific time)

| Time | Message | Condition |
|---|---|---|
| 7:00am | "Good morning! 🐶 Can someone walk me? **@person**, you're my walker today!" | skipped if already walked |
| 9:00am | "Still waiting on my walk... 🥺 @person" | only if nobody `/walked` |
| 11:00am | "Getting more desperate here, I need to go to the bathroom 😰 @person **@backup**" | only if nobody `/walked` |
| 12:00pm | "Hey can someone make sure I have enough water and food to survive? 🥣💧" | always, no reply needed |
| 1:00pm | "🚨 SOS 🚨 Still no walk…" | only if nobody `/walked` |
| 6:00pm | Evening food & water check | always, no reply needed |
| 10:00pm | "Can someone take me to my crate? I'm getting tired here 😴" | skipped if already caged |
| 11:00pm | "Still up... 🥱 Someone take me to my crate?" | only if nobody `/caged` |

Commands:

- `/walked`: Trudy replies "Thanks {name}! 🐾 Did I go pee or poo? The people need to know." with buttons **💧 Pee / 💩 Poo / 💧💩 Both / 🙅 Neither**. Anyone can tap one. Replying to that message with "both", "just pee" and so on also works, as does `/walked both`.
- `/caged`: "Thank you {name}! 😴 Goodnight, see you all tomorrow ❤️"
- `/fed`: optional, logs that someone checked her food and water.
- `/status`: today's walks, potty results, food, crate and who's on duty.
- `/chatid`: prints the chat and topic ids (for setup).
- `/help`

Each message has a few variants, so she doesn't repeat the exact same line every day. Edit them in `src/messages.ts`. Change the timing in `src/schedule.ts`.

### Design notes

- **Random but fair tagging.** The walkers are put in a shuffled "bag". Everyone gets tagged once before anyone repeats, and nobody is tagged two days in a row. The 11am backup is always a different person.
- **A "Trudy day" runs 4am–4am.** A `/caged` at 12:30am still counts for the night before.
- **DST-proof.** The cron runs every 15 minutes in UTC, and the code converts to Pacific time itself. If a send fails, the next tick in the same hour retries it.
- **Relay limits respected.** Relay has no `getChatMember`/member updates, so the people to tag come from config (`WALKERS`). The bot only uses `sendMessage`, `editMessageText`, `answerCallbackQuery`, `setWebhook`, `setMyCommands`, `getMe` and `getWebhookInfo`, all of which Relay supports.
- **Relay often sends commands privately to the bot.** With `ALLOW_DM_COMMANDS=true`, a privately-sent `/walked` still counts, and Trudy announces it in the group.
- **Webhook, not polling.** Relay POSTs each update to `https://walking-trudy.<you>.workers.dev/webhook`. The request is verified with the `X-Telegram-Bot-Api-Secret-Token` header.

### Why Cloudflare Workers

| Option | Free? | Problem |
|---|---|---|
| **Cloudflare Workers + D1** ✅ | Yes (100k requests/day, 5GB D1) | Nothing: it never sleeps, has a public HTTPS URL for the webhook, and has built-in cron |
| Render free | Yes | Spins down after 15 min idle; cron is a paid feature |
| Railway / Fly.io | No longer free | — |
| GitHub Actions cron | Yes | Cron is delayed 5–30+ min and can't receive `/walked` in real time |

The bot uses about 96 cron runs a day plus a handful of webhooks, which is far below the free limits.

## Setup

### 1. Create the bot in Relay

In Relay, open **Corgi Bot Studio** from the account that should own the bot long term:

```
/newbot
  display name: Trudy 🐶
  username:     walking_trudy_bot      (must end in "bot", can't be changed later)
/setjoingroups  → allow
/setprivacy     → disable   (so text replies to "pee or poo?" reach the bot; commands work either way)
```

Copy the token. Don't paste it in chat or git.

### 2. Deploy to Cloudflare

```bash
npm install
npx wrangler login

# Create the database and paste the printed database_id into wrangler.toml
npx wrangler d1 create walking-trudy
npm run db:migrate:remote

# Secrets
npx wrangler secret put TELEGRAM_BOT_TOKEN     # from Corgi Bot Studio
npx wrangler secret put WEBHOOK_SECRET         # e.g. `openssl rand -hex 32`
npx wrangler secret put ADMIN_SECRET           # e.g. `openssl rand -hex 32`

npm run deploy
```

### 3. Register the webhook

```bash
curl -X POST https://walking-trudy.<your-subdomain>.workers.dev/admin/setup \
  -H "Authorization: Bearer $ADMIN_SECRET"
```

This calls `getMe`, `setWebhook` (with the secret) and `setMyCommands`. The response should show `ok: true` and your bot.

### 4. Add Trudy to the group and configure

1. Group Info → Add Members → `@walking_trudy_bot`.
2. In the Trudy chat (or topic), send `/chatid`. Trudy replies with the chat id (negative) and the topic id, if any.
3. Fill in `wrangler.toml`:
   ```toml
   GROUP_CHAT_ID = "-100..."
   TOPIC_ID = ""                       # only if Trudy lives in a topic
   WALKERS = "@nick,@andres,@michael"  # Relay usernames to tag
   ```
4. `npm run deploy` again.

### 5. Test

```bash
# See the config and current Pacific time as the bot sees it
curl -X POST .../admin/config -H "Authorization: Bearer $ADMIN_SECRET"

# Send the 7am message right now (assigns a walker)
curl -X POST ".../admin/fire?slot=walk_ask" -H "Authorization: Bearer $ADMIN_SECRET"
```

Then try `/walked`, tap a button, then `/status` and `/caged`. Use `npm run tail` to watch live logs for `401`, `409` or `400` errors (see the Relay guide's troubleshooting table).

Slot ids: `walk_ask`, `walk_nudge`, `walk_desperate`, `walk_sos`, `food_water_midday`, `food_water_evening`, `crate_ask`, `crate_nudge`.

## Development

```bash
npm test          # vitest: schedule, rotation, DST, full walk/crate flows with an in-memory store
npm run typecheck
npm run dev       # local worker; trigger cron with: curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"
```

## Layout

```
src/index.ts     Worker entry: /webhook, /admin/*, cron
src/bot.ts       Command handling + scheduler logic
src/schedule.ts  Trudy's daily timetable  ← edit times here
src/messages.ts  Everything Trudy says    ← edit copy here
src/rotation.ts  Fair random tagging
src/clock.ts     Pacific time + "Trudy day" math
src/store.ts     D1 storage (+ in-memory store for tests)
src/relay.ts     Bot API client pointed at Relay
migrations/      D1 schema
```

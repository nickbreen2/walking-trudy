# walking_trudy 🐶

Trudy is the Corgi SF office dog. This bot lives in her Corgi Relay chat. It asks for walks, tags a random person each morning, logs pee and poo, reminds people about food and water, and asks for her crate at night.

It runs on **Cloudflare Workers (free tier)** and stores state in **Cloudflare D1** (free SQLite). Corgi Relay speaks the Telegram Bot API, so the bot calls `https://d1hbrzkrx7d3gv.cloudfront.net/bot<TOKEN>/<method>` instead of Telegram.

## How Trudy's day works (Pacific time)

| Time | Message | Condition |
|---|---|---|
| 7am, 9am, 11am, 1pm, 3pm, 5pm, 7pm, **9pm (last call)** | Walk reminder | Skipped if she was walked in the last 2 hours |
| 12:00pm, 6:00pm | "Hey can someone make sure I have enough water and food to survive? 🥣💧" | Always, no reply needed |
| 10:00pm | "Can someone take me to my crate? I'm getting tired here 😴" | Skipped if already caged |
| 11:00pm | "Still up... 🥱 Someone take me to my crate?" | Only if nobody `/caged` |

The walk reminder's wording depends on the day so far:

- **7am, not walked yet:** "Good morning! 🐶 Can someone walk me?"
- **9am, still not walked:** "Still waiting on my walk... 🥺"
- **11am or later, still not walked:** "Getting more desperate here, I need to go to the bathroom 😰"
- **Already walked today:** "Walk time again? 🐾 Last walk was Nick at 8:14 AM."
- **9pm:** "Last call for a walk tonight! 🌙"

Commands:

- `/walked`: Trudy replies "Thanks {name}! 🐾 Did I go pee or poo? The people need to know." with buttons **💧 Pee / 💩 Poo / 💧💩 Both / 🙅 Neither**. Anyone can tap one. Replying to that message with "both", "just pee" and so on also works, as does `/walked both`.
- `/caged`: "Thank you {name}! 😴 Goodnight, see you all tomorrow ❤️"
- `/fed`: optional, logs that someone checked her food and water.
- `/status`: today's walks, potty results, food, crate and tagging progress.
- `/join` / `/leave`: opt in to being tagged, or never be tagged.
- `/chatid`: prints the chat and topic ids (for setup).
- `/help`

Each message has a few variants, so she doesn't repeat the exact same line every day. Edit them in `src/messages.ts`. Change the timing in `src/schedule.ts` (`WALK_HOURS`, `RECENT_WALK_MINUTES`).

### Tagging (opt-in by walking)

- **Nobody is tagged at first.** Every `/walked` saves the walker's Relay user id and @username.
- **When the 10th different person uses `/walked`, tagging switches on.** Trudy announces it once in the group and explains `/leave`. Change the threshold with `TAGGING_THRESHOLD`.
- **Only people who have used `/walked` or `/join` are ever tagged.** `/join` adds someone to the pool without walking her, but only walks count toward the 10. Anyone who sends `/leave` (even before they've walked her) is never tagged, and people with no @username are skipped.
- **Each walk reminder tags one person.** Picks are random but fair: everyone is tagged once before anyone repeats, and nobody is tagged twice in a row.

### Design notes

- **A "Trudy day" runs 4am–4am.** A `/caged` at 12:30am still counts for the night before.
- **DST-proof.** The cron runs every 15 minutes in UTC, and the code converts to Pacific time itself. If a send fails, the next tick in the same hour retries it.
- **Relay limits respected.** The bot only uses `sendMessage`, `editMessageText`, `editMessageReplyMarkup`, `answerCallbackQuery`, `setWebhook`, `setMyCommands`, `getMe` and `getWebhookInfo`. `editMessageReplyMarkup` only clears the pee/poo buttons, and if it fails the error is logged and ignored. Relay can't list group members, which is another reason tagging is built from who has used `/walked`.
- **Relay often sends commands privately to the bot.** With `ALLOW_DM_COMMANDS=true`, a privately-sent `/walked` still counts, and Trudy announces it in the group.
- **Webhook, not polling.** Relay POSTs each update to `https://walking-trudy.<you>.workers.dev/webhook`. The request is verified with the `X-Telegram-Bot-Api-Secret-Token` header.

### Why Cloudflare Workers

| Option | Free? | Problem |
|---|---|---|
| **Cloudflare Workers + D1** ✅ | Yes (100k requests/day, 5GB D1) | Nothing: it never sleeps, has a public HTTPS URL for the webhook, and has built-in cron |
| Render free | Yes | Spins down after 15 min idle; cron is a paid feature |
| Railway / Fly.io | No longer free | — |
| GitHub Actions cron | Yes | Cron is delayed 5–30+ min and can't receive `/walked` in real time |

The bot uses 96 cron runs a day plus a handful of webhooks, which is far below the free limits.

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
   TOPIC_ID = ""            # only if Trudy lives in a topic
   TAGGING_THRESHOLD = "10" # tagging starts after this many different walkers
   ```
4. `npm run deploy` again.

### 5. Test

```bash
# See the config and current Pacific time as the bot sees it
curl -X POST .../admin/config -H "Authorization: Bearer $ADMIN_SECRET"

# Send the 7am walk reminder right now
curl -X POST ".../admin/fire?slot=walk_07" -H "Authorization: Bearer $ADMIN_SECRET"
```

Then try `/walked`, tap a button, then `/status` and `/caged`. Use `npm run tail` to watch live logs for `401`, `409` or `400` errors (see the Relay guide's troubleshooting table).

Slot ids: `walk_07`, `walk_09`, `walk_11`, `walk_13`, `walk_15`, `walk_17`, `walk_19`, `walk_21`, `food_water_12`, `food_water_18`, `crate_ask`, `crate_nudge`.

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
src/rotation.ts  Fair random tagging (pool = people who used /walked)
src/clock.ts     Pacific time + "Trudy day" math
src/store.ts     D1 storage (+ in-memory store for tests)
src/relay.ts     Bot API client pointed at Relay
migrations/      D1 schema
```

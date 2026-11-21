# Office Dog Bot 🐶

A Corgi Relay bot that looks after an office dog. It asks the office to walk the dog every couple of hours, logs pee and poo, reminds people about food and water, and asks for the crate at night.

It started as **Trudy** (`@walking_trudy_bot`) for the SF office. **Want one for your office's dog? Follow [Make a bot for your office dog](#make-a-bot-for-your-office-dog) below.** It takes about 30 minutes and costs nothing.

- Runs on **Cloudflare Workers + D1**, on the free tier: no server to keep up, and it never sleeps.
- Talks to **Corgi Relay** through its Telegram-compatible Bot API.
- Everything is set in `wrangler.toml`: dog name, time zone, chat. You don't have to touch the code.

---

## What the bot does

### Daily schedule (in your office's time zone)

| Time | Message | When it's skipped |
|---|---|---|
| 7am, 9am, 11am, 1pm, 3pm, 5pm, 7pm, **9pm (last call)** | Walk reminder | If the dog was walked in the last 2 hours |
| 12pm, 6pm | "Hey can someone make sure I have enough water and food to survive? 🥣💧" | Never (no reply needed) |
| 10pm | "Can someone take me to my crate? I'm getting tired here 😴" | If someone already sent `/caged` |
| 11pm | "Still up... 🥱 Someone take me to my crate?" | If someone already sent `/caged` |

The walk reminder changes with the day: "Good morning! Can someone walk me?" at 7am, then "Still waiting on my walk 🥺", then "Getting more desperate here, I need to go to the bathroom 😰" if nobody has walked them. Once someone has, it becomes "Walk time again? Last walk was Nick at 8:14 AM."

### Commands

| Command | What happens |
|---|---|
| `/walked` | "Thanks {name}! 🐾 Did I go pee or poo? The people need to know." with **💧 Pee / 💩 Poo / 💧💩 Both / 🙅 Neither** buttons. Anyone can tap. `/walked both` or replying "just pee" also works. |
| `/caged` | "Thank you {name}! 😴 Goodnight, see you all tomorrow ❤️" |
| `/fed` | Logs that someone checked food and water |
| `/status` | Today's walks, potty results, food, crate and tagging progress |
| `/join` / `/leave` | OK to tag me / never tag me |
| `/chatid` | Shows the chat and topic id (used during setup) |
| `/help` | How the bot works |

### Tagging is opt-in

People only get tagged once they've shown they're up for it:

- **Nobody is tagged at first.** Each `/walked` saves who walked the dog.
- **Tagging turns on after 10 different people have used `/walked`** (`TAGGING_THRESHOLD`). The bot announces it once.
- **Only people who used `/walked` or `/join` get tagged.** Anyone can send `/leave` to never be tagged.
- **One person is tagged per reminder.** Everyone gets a turn before anyone repeats, and nobody is tagged twice in a row.

---

## Make a bot for your office dog

You'll need:

- A **Relay** account that can add members to your office's dog chat.
- A **GitHub** account.
- A free **Cloudflare** account: sign up at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
- **Node.js 20+** on your computer. Check with `node -v`.

> **Using Claude Code?** Open your copy of the repo and ask it to walk you through this section step by step. It reads `CLAUDE.md` for the Relay details. Do the logins and secrets yourself in a normal terminal (steps 3 and 5), so tokens never end up in the chat.

### 1. Get your own copy

On GitHub, open this repo and click **Use this template → Create a new repository** (or **Fork**). Name it after your dog, e.g. `walking-biscuit`. Then:

```bash
git clone https://github.com/<you>/walking-biscuit.git
cd walking-biscuit
npm install
```

### 2. Create the bot in Relay

In Relay, open a chat with **Corgi Bot Studio**. Do this from the account that should own the bot long term, because Relay can't transfer bots yet.

```
/newbot
  display name: Biscuit 🐶
  username:     walking_biscuit_bot    ← must end in "bot" and can't be changed later
/setjoingroups  → allow
/setprivacy     → disable              ← so replies like "just pee" reach the bot
```

Bot Studio replies with a **token**. Save it in your password manager, delete it from the Bot Studio chat, and never paste it into a chat or commit it.

### 3. Log in to Cloudflare

Run this in a **regular terminal** (VS Code: Terminal → New Terminal), not in an AI chat panel, because the login needs to stay open while you approve it in the browser:

```bash
npx wrangler login     # click "Allow" in the browser, wait for "Successfully logged in"
npx wrangler whoami    # should show your email
```

### 4. Configure and deploy

Edit `wrangler.toml`:

```toml
name = "walking-biscuit"                    # your Worker's name, also its URL
...
DOG_NAME = "Biscuit"
TIMEZONE = "America/New_York"               # your office's time zone (IANA name)
GROUP_CHAT_ID = ""                          # leave empty for now, filled in at step 7
TOPIC_ID = ""
...
[[d1_databases]]
binding = "DB"                              # keep as "DB"
database_name = "walking-biscuit"
database_id = "…"                           # from the next command
```

Then create the database, set up its tables and deploy:

```bash
npx wrangler d1 create walking-biscuit     # copy the database_id it prints into wrangler.toml
npm run db:migrate:remote
npm run deploy                              # prints your https://walking-biscuit.<subdomain>.workers.dev URL
```

The first time you deploy, Cloudflare may ask you to pick a `workers.dev` subdomain, and the new URL can take a few minutes to start answering. If the very first deploy says "This Worker does not exist", run `npm run deploy` again.

### 5. Set the secrets (in your terminal)

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN                  # paste the token from step 2
openssl rand -hex 32 | npx wrangler secret put WEBHOOK_SECRET

ADMIN_SECRET=$(openssl rand -hex 32)
echo $ADMIN_SECRET                                          # save this in your password manager
echo "$ADMIN_SECRET" | npx wrangler secret put ADMIN_SECRET
```

### 6. Connect the bot to Relay

In the same terminal (so `$ADMIN_SECRET` is still set), with your Worker URL:

```bash
curl https://walking-biscuit.<subdomain>.workers.dev/        # → "Biscuit is awake 🐶"
curl -X POST https://walking-biscuit.<subdomain>.workers.dev/admin/setup \
  -H "Authorization: Bearer $ADMIN_SECRET"
```

You should see `"ok": true`, your bot's username, and a webhook URL ending in `/webhook`.

### 7. Add the bot to your dog's chat

1. In Relay, open the chat (Group Info → **Add Members**) and add `@walking_biscuit_bot`.
2. Send `/chatid` in the chat, or in the topic if the dog lives in a topic. The bot replies with:
   - `chat id`, a negative number like `-1000000000123`
   - `chat type`, which should be `group` or `supergroup`. If it says `private`, Relay sent your command privately; try again from the group's message box.
   - `topic id`, only shown if you're in a topic
3. Copy the numbers from Relay (don't retype them) into `wrangler.toml`:
   ```toml
   GROUP_CHAT_ID = "-1000000000123"
   TOPIC_ID = "134"     # or "" if there's no topic
   ```
4. `npm run deploy`, then commit and push.

### 8. Check it works

Send `/help` in the chat. If the bot replies, you're live. 🎉 The schedule starts on its own at the next reminder time, so nothing else needs switching on.

Want to see a scheduled message right away?

```bash
curl -X POST "https://walking-biscuit.<subdomain>.workers.dev/admin/fire?slot=walk_07" \
  -H "Authorization: Bearer $ADMIN_SECRET"
```

This posts that one message now and doesn't change the schedule. Then try `/walked`, tap a button, and send `/status`.

---

## Customizing

| What | Where |
|---|---|
| Dog's name | `DOG_NAME` in `wrangler.toml` |
| Time zone | `TIMEZONE` in `wrangler.toml` |
| Days the schedule runs (e.g. weekdays only) | `ACTIVE_DAYS = "Mon,Tue,Wed,Thu,Fri"` in `wrangler.toml` |
| How many walkers before tagging starts | `TAGGING_THRESHOLD` in `wrangler.toml` |
| Walk reminder times, food times, crate time | `src/schedule.ts` (`WALK_HOURS`, `RECENT_WALK_MINUTES`, `SCHEDULE`) |
| Everything the dog says | `src/messages.ts`. Each message has a few variants, picked at random |

After any change: `npm test`, then `npm run deploy`.

## Troubleshooting

| Problem | Fix |
|---|---|
| Bot doesn't reply at all | Run `npm run tail` and send a command. If nothing shows up, run step 6 again. |
| `401` / `ACCESS_TOKEN_INVALID` | Wrong token. Run `npx wrangler secret put TELEGRAM_BOT_TOKEN` again. |
| `400 CHAT_WRITE_FORBIDDEN` | The bot isn't in the chat, or `GROUP_CHAT_ID` is wrong. |
| `MESSAGE_THREAD_NOT_FOUND` | Wrong `TOPIC_ID`. Send `/chatid` in the topic again. |
| Commands are ignored | The command came from a different chat than `GROUP_CHAT_ID`. Check with `/chatid`. |
| Can't add the bot to the group | In Corgi Bot Studio, run `/setjoingroups` and allow it. |
| `wrangler login` never finishes | Run it in a normal terminal and keep it open until it says you're logged in. |
| Token leaked | In Corgi Bot Studio, run `/revoke`, then set the new one with `wrangler secret put`. |

## How it works

- **Cloudflare Workers** runs the bot. Relay sends every message to `/webhook`, and the bot checks the `X-Telegram-Bot-Api-Secret-Token` header so only Relay can call it. A cron runs every 15 minutes and sends any message that's due.
- **Time zones and daylight saving** are handled in code: the cron runs in UTC and the bot converts to `TIMEZONE`. If a send fails, the next tick in that hour retries it.
- **A dog's day runs 4am to 4am**, so a `/caged` at 12:30am counts for the night before.
- **Cloudflare D1** stores walks, who walked, the crate and food log, and who has opted in or out of tagging.
- **Relay limits:** Relay supports a subset of the Telegram Bot API. The bot only uses `sendMessage`, `editMessageText`, `editMessageReplyMarkup`, `answerCallbackQuery`, `setWebhook`, `getWebhookInfo`, `setMyCommands` and `getMe`. Relay can't list group members, which is why the tagging list is built from `/walked` and `/join`.
- **Cost:** about 96 cron runs a day plus a few webhooks, far below the free limits (100k requests a day).

### Admin endpoints

All of these are `POST` with `Authorization: Bearer $ADMIN_SECRET`:

| Endpoint | What it does |
|---|---|
| `/admin/setup` | Registers the webhook and command menu with Relay |
| `/admin/config` | Shows the bot's settings and current local time |
| `/admin/fire?slot=<id>` | Sends one scheduled message now |
| `/admin/tick` | Runs the scheduler as if the cron just fired |

Slot ids: `walk_07`, `walk_09`, `walk_11`, `walk_13`, `walk_15`, `walk_17`, `walk_19`, `walk_21`, `food_water_12`, `food_water_18`, `crate_ask`, `crate_nudge`.

## Development

```bash
npm test           # schedule, tagging, time zones, full walk and crate flows (no Cloudflare needed)
npm run typecheck
npm run dev        # local Worker; trigger the cron with: curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"
npm run tail       # live logs from the deployed Worker
```

```
src/index.ts     Worker entry: /webhook, /admin/*, cron
src/bot.ts       Commands and scheduler logic
src/schedule.ts  The daily timetable        ← edit times here
src/messages.ts  Everything the dog says    ← edit wording here
src/rotation.ts  Fair random tagging
src/clock.ts     Time zone and "dog day" math
src/store.ts     D1 storage (+ in-memory store for tests)
src/relay.ts     Bot API client pointed at Relay
migrations/      Database tables
```

Made with ❤️ for Trudy, the Corgi SF office dog.

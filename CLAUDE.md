# CLAUDE.md

Telegram-style bot for **Corgi Relay** (Telegram Bot API clone) that manages Trudy the office dog's walks, potty log, food/water reminders and crate time. Deployed on Cloudflare Workers + D1 (free tier). See README.md for the product behavior and setup.

## Commands
- `npm test` — vitest (runs in Node with `MemoryStore` + `FakeApi`; no Cloudflare needed)
- `npm run typecheck`
- `npm run deploy` / `npm run tail`
- New DB changes: add `migrations/000N_*.sql`, then `npm run db:migrate:remote`

## Relay constraints (from "Moving a Telegram Bot to Corgi Relay")
- Base URL `https://d1hbrzkrx7d3gv.cloudfront.net`, paths identical to Telegram.
- Updates delivered: only `message`, `edited_message`, `callback_query`.
- NOT supported (404 METHOD_NOT_FOUND): sendChatAction, getChat, getChatMember, getChatAdministrators, pinning, reactions, polls, dice, forward/copyMessage, editMessageCaption/Media, sendMediaGroup. Don't use them.
- Supported and used here: sendMessage (HTML, inline keyboards, message_thread_id), editMessageText, answerCallbackQuery, setWebhook, getWebhookInfo, setMyCommands, getMe.
- Webhook needs a publicly trusted HTTPS cert (workers.dev is fine); secret comes back in `X-Telegram-Bot-Api-Secret-Token`.
- Commands are often sent privately to the bot; we accept private commands (`ALLOW_DM_COMMANDS`) and announce in the group.
- One receiver per token: never run polling alongside the webhook (409 Conflict).
- Limits: text 4096 chars, callback_data 64 bytes.

## Conventions
- All user-facing text lives in `src/messages.ts`, sent with `parse_mode: "HTML"` — always `escapeHtml` user-supplied names.
- Timetable lives in `src/schedule.ts`; times are local (`TIMEZONE`, default America/Los_Angeles). Cron is `*/15 * * * *` UTC.
- Business logic in `src/bot.ts` takes a `Deps` object (store, api, config, now, random) so it is testable; keep Cloudflare specifics in `src/index.ts`.
- Never commit the bot token; it's a Wrangler secret.
- Tagging is consent-based: no tags until `TAGGING_THRESHOLD` (10) different people have used /walked; then only people in the `walkers` table who walked or sent /join, and haven't sent /leave, are tagged. Don't add a hard-coded list of people to tag.

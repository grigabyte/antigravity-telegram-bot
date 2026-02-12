# AGENTS.md

Practical installation + maintenance playbook for AI coding agents working in this repository.

---

## 1) Fast Install Flow (Agent-first)

When user asks “setup this bot”, follow this exact order.

### Step A — Prerequisites

Confirm user has:
- Node.js 18+
- Telegram account
- Antigravity credentials (OAuth)
- Supabase project
- Vercel project

### Step B — Clone + install

```bash
git clone https://github.com/grigabyte/antigravity-telegram-bot.git
cd antigravity-telegram-bot
npm install
```

### Step C — Database

Run SQL scripts in Supabase SQL editor in this order:
1. `scripts/setup-supabase.sql`
2. `scripts/setup-batching-and-proactive.sql`
3. `scripts/setup-advanced-memory-and-signals.sql` (recommended)

### Step D — Production env vars (Vercel)

Always use `echo -n` while adding envs.

Required minimum:
- `TELEGRAM_BOT_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `ANTIGRAVITY_CLIENT_ID`
- `ANTIGRAVITY_CLIENT_SECRET`
- `ANTIGRAVITY_EMAIL`
- `ANTIGRAVITY_REFRESH_TOKEN`
- `ANTIGRAVITY_PROJECT_ID`
- `TELEGRAM_WEBHOOK_SECRET`
- `PROACTIVE_CRON_SECRET`

Optional:
- `ADMIN_USER_ID`
- `OPENROUTER_API_KEY`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`

### Step E — Deploy + webhook

```bash
vercel --prod
VERCEL_URL=your-app.vercel.app TELEGRAM_BOT_TOKEN=your-token TELEGRAM_WEBHOOK_SECRET=your-secret npm run set-webhook
```

### Step F — Smoke checks

1. `GET /api/webhook` should return `status: ok`, `version: 8.6`, and `schema`.
2. Send `/start` in Telegram.
3. Test `/stats`, `/memory`, `/remind`.

---

## 2) Proactive Scheduler Modes

### Vercel Pro

User may enable native Vercel cron for `/api/proactive`.

### Vercel Hobby (default free path)

Use external scheduler. This repo includes GitHub Actions scheduler:
- `.github/workflows/proactive-cron.yml`
- every 15 minutes

Required GitHub repository secrets:
- `PROACTIVE_URL` (e.g. `https://your-app.vercel.app/api/proactive`)
- `PROACTIVE_CRON_SECRET`

---

## 3) Commit & Identity Rules (Important)

Use Git identity:
- `name`: `grigabyte`
- `email`: `grigabyte@users.noreply.github.com`

Before creating commits, verify:

```bash
git config user.name
git config user.email
```

If wrong, set local repo identity (do not change global unless user asks):

```bash
git config user.name "grigabyte"
git config user.email "grigabyte@users.noreply.github.com"
```

Never commit secrets (`.env`, keys, tokens).

---

## 4) Testing Policy

Run before push:

```bash
npm test
```

Critical tests cover:
- webhook authorization
- proactive authorization
- dedupe behavior
- ownership checks in memory pin/unpin
- import safety/rollback
- SSRF/url guard baseline

---

## 5) Operational Safety

- Do not log secrets
- Keep `TELEGRAM_WEBHOOK_SECRET` and `PROACTIVE_CRON_SECRET` configured in production
- If any secret may have leaked, rotate immediately
- Keep `ADMIN_USER_ID` set for private bot mode

---

## 6) Repository Conventions

- Keep entrypoints in `api/`
- Keep core logic in `src/` modules
- Comments in English
- User-facing bot messages in Russian
- Prefer explicit types over `any`

---

## 7) Quick Troubleshooting Map

- `cron_secret_not_configured` → set `PROACTIVE_CRON_SECRET` in Vercel
- webhook unauthorized → check `TELEGRAM_WEBHOOK_SECRET` and reset webhook
- `schema: partial` → apply missing SQL scripts
- deploy output errors on Vercel → verify `vercel.json` + project settings

---

## 8) Critical Architecture Context for Agents

This section is intentionally concise but mandatory for safe changes.

### Request pipeline

`api/webhook.ts` → `src/handlers/webhook.ts` is the core pipeline:
- webhook auth (`TELEGRAM_WEBHOOK_SECRET`)
- user access gate (`ADMIN_USER_ID`)
- dedupe (`processed_updates`)
- batching (`inbound_events`)
- retrieval + model call + memory updates + telegram response

### Memory architecture

Memory retrieval mode is selected by `MEMORY_RETRIEVAL_MODE` (`src/config.ts`):

1. **RAG mode** (`rag`)
   - module: `src/memory/rag-memory.ts`
   - storage: `memory_items_v2` + `memory_chunks` + `match_memory_chunks`
   - embeddings path: `src/memory/embeddings.ts`

2. **Supabase lexical mode** (`supabase`)
   - module: `src/memory/supabase-memory.ts`
   - retrieval over recent history/signals with lexical + recency scoring
   - designed as low-cost fallback path

Both modes are production paths. Do not remove either path without explicit migration plan.

### Persistence boundaries

`src/db/supabase.ts` is the only DB boundary for app logic.
Keep new SQL/schema assumptions aligned with:
- `scripts/setup-supabase.sql` (core)
- `scripts/setup-batching-and-proactive.sql` (batch/proactive/dedupe)
- `scripts/setup-advanced-memory-and-signals.sql` (RAG/signals/metrics)

### Proactive architecture

- endpoint: `api/proactive.ts`
- scheduler core: `src/proactive/scheduler.ts`
- auth: `PROACTIVE_CRON_SECRET`
- deployment modes:
  - Hobby: external scheduler (GitHub Actions workflow in repo)
  - Pro: optional native Vercel Cron

### Safety invariants

- Never bypass webhook/proactive secret checks.
- Never remove dedupe behavior.
- Keep import operations rollback-safe.
- Keep `pin/unpin` user-scoped (no cross-user updates).

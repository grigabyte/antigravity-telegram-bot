# Technical Domain

## Stack
- TypeScript (strict)
- Vercel Serverless API
- Supabase REST API
- Antigravity OAuth + Gemini 3 Pro

## Architecture Rules
- Keep `api/webhook.ts` as the Vercel entry.
- Move logic into modules under `src/` and import in webhook.
- Avoid new dependencies without approval.
- Keep user-facing messages in Russian.

## Naming
- Modules in `src/` use kebab-case.
- Use named exports.

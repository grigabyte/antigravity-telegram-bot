# Code Quality Standards

These standards apply to all changes in this repository.

## General
- Keep functions small and single-purpose.
- Prefer pure functions; minimize side effects.
- Avoid duplicate logic; centralize shared behavior in modules.
- No new dependencies without explicit approval.

## TypeScript
- Use `strict`-compatible types; avoid `any` and unsafe casts.
- Export explicit types for module boundaries.
- Prefer `const` over `let` unless reassignment is required.
- Use named exports (default export is only allowed for the Vercel handler).

## Error Handling
- Throw errors with actionable context; never swallow silently.
- Surface user-facing errors through a single formatter.
- Log unexpected errors with concise metadata (no secrets).

## Async & IO
- Use `AbortController` with timeouts for network calls.
- Handle non-2xx responses explicitly.
- Avoid repeated queries; reuse results within a request.

## Structure & Naming
- Modules should reflect domain boundaries (db, ai, telegram, memory, commands, utils).
- File names should be kebab-case.
- Keep configuration in a single module; avoid scattered env lookups.

## Formatting
- 2-space indentation.
- Semicolons required.
- Comments only when they add non-obvious context.

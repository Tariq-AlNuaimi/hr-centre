---
name: ship
description: Pre-commit verification -- typecheck + lint + production build. Use before pushing changes that touch types, schemas, API routes, or server components. Stops on the first failure with the file:line so the next edit is targeted. Trigger phrases: "ship", "verify", "is this green", "ready to push", "/ship".
---

# Ship

Run the three local checks CI would run, in cheapest-to-most-expensive order. Stop on the first failure.

## Steps
1. **Typecheck.** `npx tsc --noEmit`. Catches schema-vs-code drift after Prisma generate and Auth.js callback fallout.
2. **Lint.** `npm run lint`. Surfaces unused imports, hooks-rules violations, missing keys, accessibility regressions.
3. **Build.** `npm run build`. Catches Next.js-specific issues that tsc and ESLint miss: server/client boundary violations, missing `"use client"`, invalid metadata exports, server-only imports leaking to the client bundle.

## On failure
- Report the failing step, the file:line, and the first 20 lines of error output.
- Do NOT run the next step. Do NOT push. Do NOT commit.
- Suggest the targeted fix; confirm with the user before re-running.

## On success
- Print: `ship: green -- typecheck + lint + build all pass`.
- If there are staged or unstaged changes, offer to commit + push. Do not auto-push unless the user already asked for it in this session.

## Skip when
- You only touched docs, files under `.claude/`, or `messages/*.json` -- none of those affect the build. Run just `npm run lint` instead.
- You only touched `prisma/schema.prisma` -- run `npm run prisma:generate` first, then the full ship sequence (typecheck will catch the rest).

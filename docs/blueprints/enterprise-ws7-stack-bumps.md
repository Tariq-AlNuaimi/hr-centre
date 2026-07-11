# Blueprint — Enterprise WS-7: stack bumps (Node 24 · zod 4 · Prettier gate)

Scope: package.json, .nvmrc, .prettierrc.json, .prettierignore, scripts/ship.mjs, .github/workflows/**, components/shared/FormField.tsx, lib/validations/**, lib/env.ts

> Governs WS-7: raise the developer/CI Node pins to 24 (runtime already there), migrate the
> validation library zod v3→v4, and adopt Prettier with a `format` `/ship` gate. Decision of
> record: **ADR-046** (supersedes ADR-001 for the Node + zod major pins only). No new API route or
> page, no new `lib/` capability — so neither the blueprint-gate nor the build-vs-buy gate fires;
> this doc is the requirements contract `/qa` traces against.

## Problem & outcome

The stack drifted on three currency axes: dev/CI Node pins lagged the Node-24 production image;
zod sat on v3 with a now-deprecated string-format API on the Secure pillar's critical path; and the
repo had no formatter (style was review-enforced). Outcome: all Node pins consistent at 24, zod on 4
with idiomatic top-level formats and zero semantic change to the validation boundary, and Prettier
gated in `/ship` so formatting is deterministic.

## User stories

- **US-1 (consistent runtime).** As a contributor/CI, I run the SAME Node major (24) the production
  Docker image runs, so a version-specific bug can't slip past local/CI onto prod.
- **US-2 (current, idiomatic validation).** As a maintainer, zod is on the supported v4 line with
  `z.email()`/`z.url()` (not the deprecated method forms), so the API-boundary contracts don't accrue
  deprecation debt.
- **US-3 (deterministic formatting).** As a reviewer, `format:check` is a `/ship` gate, so style is
  automatic and diffs are noise-free — no more style nits in review.
- **US-4 (green by construction).** As the template, `/ship` stays green: the zod bump is
  semantics-preserving and the repo was normalized once with `prettier --write`.

## Scenarios (happy + worst path)

- **Node happy.** engines `>=24` + `.nvmrc 24` + CI `node-version: 24`; Dockerfile already 24 → all
  aligned; no code change (Node 24 is back-compat with the 22 APIs used).
- **zod happy.** `zod@^4`; `@hookform/resolvers` was already v5 (zod-4-native), so FormField's
  resolver generic drops its v3 bridge; schemas unchanged in meaning; deprecated `.string().email()`
  → `z.email()`. tsc + build + all contract tests green.
- **zod worst.** A transform chain (`.toLowerCase()`/`.trim()`) that doesn't survive `z.email()` is
  reverted to the deprecated-but-functional `z.string().email()....` for that occurrence (documented),
  never a semantic change. A third-party zod-v3 peer conflict is caught by `/ship` typecheck/build.
- **Prettier worst.** First `prettier --check .` on an un-normalized repo would be RED across many
  files; mitigated by a one-time `prettier --write .` adoption pass so the gate starts green. The
  `.prettierignore` keeps build/generated/vendored dirs out so the gate scopes to source.

## Architecture / change sketch

- `package.json` — `engines.node >=24`; `zod ^4`; `prettier` devDep (exact-pinned); `format` +
  `format:check` scripts.
- `.nvmrc` (24), `.prettierrc.json` (house style), `.prettierignore` (node_modules/.next/generated/
  coverage/lockfile/messages).
- `scripts/ship.mjs` — new phase-A `format` gate mirroring `lint` (`prettier --check .` → RED on drift).
- `.github/workflows/*.yml` — `node-version: 24` everywhere.
- `components/shared/FormField.tsx` — `useZodForm` generic constrained to `ZodType<FieldValues>`
  for the zod-4 + resolvers-v5 pairing.
- `lib/validations/*` + `lib/env.ts` + route schemas — deprecated string formats → top-level forms.
- `docs/decisions/ADR-046-*` — the locked-stack superseding record.

## Tier

`shared` — a stack-currency/tooling change; inert on product behavior. No security-floor change (the
validation boundary keeps identical semantics; ESLint security rules + hooks unchanged).

## Open questions — RESOLVED (non-interactive; recommended defaults)

1. **zod 4 vs stay on 3?** → Bump to 4 (benchmark currency item; v3 formats deprecated). ADR-046.
2. **Prettier vs Biome?** → Prettier alongside the existing ESLint (lower-risk, reversible; keeps the
   local `eslint-rules/` plugin intact). Biome tracked as a future option.
3. **Reformat the whole repo or only-new?** → One-time `prettier --write .` adoption pass so the gate
   is meaningful and green; scoped by `.prettierignore`.

## Non-goals / follow-ons

- Biome migration (future; ADR if pursued).
- Prettier-ESLint integration plugin (`eslint-config-prettier`) — optional later; the two run as
  independent `/ship` gates for now, and the house `.prettierrc` avoids rule conflicts.

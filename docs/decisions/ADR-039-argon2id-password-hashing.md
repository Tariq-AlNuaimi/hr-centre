# ADR-039 — Argon2id password hashing (supersede bcryptjs)

**Status:** Accepted (enterprise pivot, operator-directed 2026-07-11)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Supersedes:** the bcryptjs password-hashing choice (in `lib/password.ts`
— `hashPassword` calls `bcrypt.hash` at `BCRYPT_COST` — and its verify side in
`lib/auth.ts:81`, `bcrypt.compare` against `users.passwordHash`). This touches
an Ask-before file (`lib/auth.ts`, plus `lib/password.ts`), so per CLAUDE.md
"Ask before" this ADR is the required record for the change.

## Context

The repo hashes passwords with **bcryptjs** (pure-JS): `lib/password.ts:1`
imports `bcryptjs` and `hashPassword` emits a bcrypt hash at a hardcoded cost;
`lib/auth.ts:81` verifies the credentials login with `bcrypt.compare`. bcryptjs
is OWASP-*acceptable* at cost ≥ 12 but is not the 2026 preferred algorithm, and
being pure JS it is the slowest real option — the wrong direction for a security
floor.

OWASP's current Password Storage guidance makes **Argon2id** the preferred
algorithm; bcrypt and scrypt are "acceptable," not "preferred." The historical
objection to native `argon2` bindings — node-gyp / node-pre-gyp build pain that
broke portability — is dissolved by the Docker-first rail (ADR-035): a prebuilt
napi module resolves and builds cleanly in-image, so the "zero native deps"
argument that kept bcryptjs no longer buys anything.

Pivot report source: `docs/research/v2/enterprise-benchmark-v2.html` category
C03 (Auth & Identity), which ranks this a P0 replacement.

## Decision drivers

- **OWASP-preferred algorithm** — Argon2id is the current security floor for
  password storage; the incumbent is merely "acceptable."
- **Zero-downtime silent migration** — existing bcrypt hashes must keep working;
  users migrate to Argon2id without a forced reset.
- **Docker-first removes the native-binding objection** — the prebuilt napi
  module builds once in-image (ADR-035), so portability is no longer a risk.
- **No node-gyp at deploy** — the chosen library ships prebuilt binaries; the
  Vercel/Neon build path (ADR-006) sees no native toolchain step.

## Considered options

### Option 1 — `@node-rs/argon2` (Argon2id) (chosen)

Prebuilt napi module (Rust-backed) — no node-gyp at install or deploy. Keep
`bcryptjs.compare` for legacy hashes and **rehash-on-successful-login**: on a
successful credential check, if the stored hash is bcrypt, re-hash the plaintext
with Argon2id and persist it, so the user's next login verifies against
Argon2id. `hash-wasm` (pure WASM) is the fallback for any environment where the
napi binary cannot load. Default params to OWASP guidance as the **starting
point**, tuned per deployment: memory 19456 KiB, iterations 2, parallelism 1.

- **Good:** OWASP-preferred default; silent per-login migration; clean in
  Docker; prebuilt napi means no build toolchain.
- **Bad:** introduces a native dependency (mitigated by the prebuilt napi
  binary + the Docker-first rail + the `hash-wasm` fallback).

### Option 2 — Keep bcryptjs

- **Good:** pure JS, zero native deps, already wired and tested.
- **Bad:** not the OWASP-preferred algorithm; pure-JS bcrypt is also slower and
  weaker per unit cost than native Argon2id — a floor that points the wrong way.

### Option 3 — `node:crypto` scrypt

- **Good:** in the Node standard library — zero third-party dep.
- **Bad:** weaker tuning and verification story than Argon2id (no built-in
  encoded-hash format; params must be managed by hand); scrypt is OWASP-
  acceptable but not its first choice.

## Decision

Adopt **Argon2id via `@node-rs/argon2`** as the password-hashing algorithm,
retaining `bcryptjs.compare` as a legacy-verify path with rehash-on-successful-
login, and `hash-wasm` as a pure-WASM fallback. The deciding driver is the pair
**OWASP-preferred default + zero-downtime silent migration**, unblocked by the
Docker-first rail that removes the only real objection (native-binding
portability) to argon2 that ever justified staying on pure-JS bcrypt.

## Consequences

### Positive
- Password storage sits on the OWASP-preferred algorithm — the security floor
  moves up without a user-visible reset.
- Existing users migrate transparently: one successful login re-hashes them to
  Argon2id.
- The prebuilt napi + Docker-first rail means the stronger algorithm costs
  nothing in build/deploy portability.

### Negative
- A native dependency enters the tree (offset by the prebuilt binary + WASM
  fallback; no node-gyp).
- A bcrypt legacy-verify branch must live alongside Argon2id until telemetry
  shows no bcrypt hashes remain — two verify paths to maintain in the interim.
- Argon2id is deliberately slower/heavier per verify than the old default (a
  small SPEED cost, by design).

### Mitigations
- `hash-wasm` fallback covers environments where the napi binary won't load.
- Params live in one place (as `BCRYPT_COST` did) so they tune per deployment
  without touching call sites.
- **SECURITY.md must record** the algorithm change (§ password hashing + the
  data-class note on `users.passwordHash`) and the legacy-verify window during
  which bcrypt hashes are still accepted.

## Alternatives considered
1. **Keep bcryptjs** — rejected: acceptable but not OWASP-preferred, and slowest.
2. **`node:crypto` scrypt** — rejected: weaker tuning/verification story; not
   OWASP's first choice.
3. **Native `bcrypt`** — rejected: still bcrypt (not Argon2id) and re-imports the
   node-gyp problem the chosen prebuilt napi avoids.

## Migration triggers
- Revisit the Argon2id params on hardware upgrades — raise memory and/or
  iterations as the deployment's CPU/RAM budget grows.
- **Drop the bcrypt legacy-verify + rehash path** once telemetry confirms no
  bcrypt-format hashes remain in `users.passwordHash`.

## Related
- ADR-035 — Docker-first rail; removes the native-binding objection to argon2.
- ADR-037 — enterprise security floor (this is the P0 password-storage slice).
- SECURITY.md — must record the algorithm change and the legacy-verify window.
- `docs/research/v2/03-auth-identity.md` — the C03 benchmark and recommendation.

# ADR-031 — Editable AI / scoring config in Settings (DB-then-env, encrypted token)

**Status:** Accepted
**Date:** 2026-06-27
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Supersedes:** the "env-driven, surfaced read-only" stance of ADR-030 for the LLM
seam and ADR-029 for the scoring seam (the seams themselves stand; only *where the
config is read from* changes).

## Context

ADR-030 (LLM) and ADR-029 (scoring) modelled both AI/scoring seams as **env-driven,
read-only** config: IT sets `LLM_ENDPOINT_URL` / `_TOKEN` / `LLM_MODEL` and
`SCORING_SERVICE_URL` / `_TOKEN` on the platform, and the Settings page would only
*surface* them read-only (UI-SPEC D.10 said "env-driven; surfaced read-only for
transparency"). ADR-030's own migration triggers already anticipated "push
`LLM_MODEL` selection into org settings (the env default stays the fallback)."

The operator has now decided (2026-06-27) that an **HR_ADMIN should configure the
AI/scoring endpoints from the Settings UI**, not only via platform env vars — so a
non-developer operator can point the platform at a LiteLLM gateway / scoring service
without a redeploy. This supersedes the read-only stance.

The hard constraint: one of these values — the **endpoint tokens** — is **Restricted**
(SECURITY.md §1). Storing a Restricted secret in an ordinary DB column, returning it
to the browser, or logging it would be a regression against the security floor.

## Decision

Make the AI/scoring config **editable in Settings**, stored per-org in a new
`AppSetting` key/value table, read with **DB-setting-THEN-env precedence**, env
retained as the override/fallback:

1. **Model — `AppSetting`** `{ orgId, key, value, valueEncrypted, updatedById }`,
   `@@unique([orgId, key])`. Non-secret settings (endpoint URLs, model id, retention
   days, default language, branding) live in `value` (plaintext — they are not
   secrets). The two **tokens** live in `valueEncrypted` as **AES-256-GCM ciphertext**.
   Audited automatically (config changes are audit-worthy).

2. **Encryption at rest — `lib/crypto.ts`.** AES-256-GCM via `node:crypto`; the key is
   derived from `AUTH_SECRET` with HKDF-SHA256 and a fixed app-specific `info` label
   (no new secret to manage — `AUTH_SECRET` is already Restricted and required).
   `encryptSecret`/`decryptSecret` store `iv:authTag:ciphertext` (base64). Rotating
   `AUTH_SECRET` invalidates stored ciphertext (documented; re-enter the tokens) — the
   same operational caveat the JWT/token-HMAC keys already carry.

3. **`valueEncrypted` is Restricted-handled in the SAME commit:** added to
   `SCRUB_FIELDS` (`lib/prisma/audit-extension.ts`) + its assertion
   (`tests/contracts/audit-scrub.test.ts`), so an `AppSetting` write never lands the
   ciphertext in the audit log. The token is **write-only / masked** in every read:
   the API returns a boolean "is set" + a masked hint, **never** the plaintext or the
   ciphertext. The decrypted token is materialized **only** server-side at the moment
   of the outbound LLM/scoring call.

4. **Precedence (`lib/settings.ts`):** `resolveLlmConfig(orgId)` /
   `resolveScoringConfig(orgId)` read the DB setting first, fall back to the env var.
   `lib/llm.ts` / `lib/scoring.ts` stay pure transport: they accept a **resolved
   config** (injected by the calling service, which has `orgId`) and otherwise fall
   back to their existing env reads — so their isolated unit tests are unchanged.
   `isLlmConfiguredFor(orgId)` / `isScoringConfiguredFor(orgId)` gate the features on
   the effective (DB-then-env) config.

5. **Auth:** the settings write route is `withAdminAuth` (HR_ADMIN) + zod +
   `withRateLimit` OUTSIDE. orgId-scoped.

## Consequences

### Positive
- A non-developer operator wires AI/scoring from the UI, no redeploy.
- The env var still works as a platform-level override/fallback (IT can pin it), so
  nothing about the current deployment breaks; an org with no DB setting behaves
  exactly as before.
- The Restricted token never leaves the server in plaintext and never reaches the
  audit log or the client — the security floor holds.

### Negative
- A new encrypted column + a key-derivation dependency on `AUTH_SECRET`: rotating
  `AUTH_SECRET` orphans the stored ciphertext (re-enter tokens). Documented in
  SECURITY.md §4/§6 alongside the existing JWT/token-HMAC rotation caveats.
- The config read is now async + DB-touching on the scoring/LLM paths (one indexed
  `app_settings` lookup, negligible; results are not hot-looped).

### Mitigations
- AES-256-GCM is authenticated (tamper-evident); a corrupted/forged ciphertext fails
  `decryptSecret` → treated as "not configured", never a crash.
- The masked-read contract is enforced in the service (the plaintext never enters a
  DTO); ESLint `no-secret-env-in-console` + the metadata-only logging discipline
  still apply.

## Alternatives considered
1. **Keep env-only / read-only surface (ADR-030 as-is)** — rejected by the operator:
   requires IT + a redeploy to change an endpoint; the operator wants self-service.
2. **Store the token in plaintext `value`** — rejected: a Restricted secret at rest
   in a readable column, recoverable from a DB read; violates SECURITY.md §1.
3. **pgcrypto column encryption** — rejected for now: pushes the key into the DB
   layer / connection; app-layer AES-GCM keeps the key derivation in one auditable
   place (`lib/crypto.ts`) and is portable off Neon (ARCHITECTURE §10).
4. **A dedicated KMS** — out of scope for the prototype rail; revisit at `/handoff`
   if the IT team runs one (a `lib/crypto.ts` swap, not a schema change).

## Migration triggers
- A KMS/HSM at handoff → swap `lib/crypto.ts`'s key source; `AppSetting` unchanged.
- More editable settings → new `AppSetting` keys; secret ones reuse `valueEncrypted`
  + the masked-read contract.

## Related
- ADR-030 (bounded LLM seam), ADR-029 (scoring seam) — the seams this re-homes.
- `lib/crypto.ts`, `lib/settings.ts`, `lib/llm.ts`, `lib/scoring.ts`,
  `lib/prisma/audit-extension.ts` (`SCRUB_FIELDS`), `prisma/schema.prisma`
  (`AppSetting`).
- SECURITY.md §1 (data classes), §4 (encryption), §6 (secrets).
- `docs/blueprints/phase-8-compliance-settings.md`, UI-SPEC D.10/D.11.

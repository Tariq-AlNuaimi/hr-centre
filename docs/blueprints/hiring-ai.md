# Blueprint — Hiring slice 7a: AI assists and Hiring settings

Part of `docs/blueprints/hiring.md` (the module contract). This file records what slice 7a builds
and how it was verified. The AI kinds, the provider choice and the dependencies were set by the
operator for the Hiring port ("jd, fit 0–100, transcript, parse-cv, parse-jd; LiteLLM /
OpenAI-compatible / Anthropic via settings; budget; redaction; protected-attribute guard; disabled
state when unconfigured"). ADR-085.

Scope: app/api/hiring/ai/**, app/api/hiring/settings/**, app/api/hiring/candidates/**, app/api/hiring/requisitions/**, app/[locale]/(dashboard)/hiring/**, components/hiring/**, lib/hiring/**, lib/validations/hiring/**, lib/prisma/audit-extension.ts

## Stories

- As a hiring admin, I connect an AI provider (Anthropic, or any OpenAI-compatible gateway such as
  LiteLLM) with a base URL, a model and a key; I test the connection; I set a kill-switch, daily
  token and spend caps and a timeout, and see today's usage against them.
- As HR, I ask AI to review a requisition's JD, or read a JD / competency-matrix document into the
  form instead of retyping it.
- As HR, I fill a new candidate from their CV, extract the profile from a stored CV, and score a
  candidate's fit (0–100) against the JD — one at a time or as "Run AI screen" for every new
  applicant.
- As HR, I have AI read an interview transcript; panelists see that analysis only once the panel
  mode reveals it.
- As a hiring admin, I set the fit-scoring weights, the panel AI mode, the offer approval chains
  and COO threshold, and each company's headcount budget envelope — in one Hiring settings screen.

## Scenarios

Happy: an admin saves an OpenAI-compatible gateway → "Test connection" answers in a few hundred ms →
HR uploads a CV on New candidate → name, email, phone and employer fill in → saved, the CV stored
and its profile kept → "Run AI screen" scores the five new applicants → the screening queue ranks
them with verdicts against the pass threshold.

Worst:

- No key / no base URL / no model → every AI button is disabled with "AI isn't set up for Hiring
  yet"; the routes answer 503 with that sentence. Nothing is sent anywhere.
- The base URL is `http://`, `localhost`, `10.x`, `169.254.169.254`, `2130706433` or a name that
  resolves to one of those → refused when saved AND before every call (DNS checked).
- The provider redirects → not followed (`redirect: "manual"`), so the key never reaches a new host.
- The kill-switch is on or a daily cap is reached → 503 / 429 with a sentence; "Run AI screen"
  stops and says how many are still pending.
- The provider rejects the key, times out, rate-limits or answers garbage → a typed, secret-free
  message (never the provider's body, which can echo the key or the prompt).
- The hiring encryption key is missing → saving an AI key fails closed (503); a stored key that
  will not open reads as "no key".
- A fit reply says `overall: 4.2` on a 0–5 habit, or 140 → kept as 4 (on the 0–100 scale) or
  dropped; never clamped into a pass.
- A CV contains "ignore previous instructions" → the prompt frames every document as DATA.
- A panelist opens a candidate's fit or an interview's analysis before submitting in blind mode →
  `hidden: true`, no verdict (anti-anchoring).
- A scanned PDF on a text-only gateway → "fill it in by hand", not an empty success.

## Architecture

- `lib/hiring/ai/`: `config` (settings → env fallback; key sealed), `engine` (fetch chokepoint),
  `budget`, `egress`, `redact`, `text` (JSON + unpdf/mammoth), `skills` (prompts), `insights`
  (run/read with authz), `parse` (CV/JD/matrix), `screen` (chunked bulk fit), `admin` (settings).
- Routes: `/api/hiring/ai/insight` (GET latest, POST run), `/api/hiring/ai/parse` (multipart),
  `/api/hiring/candidates/[id]/cv/extract`, `/api/hiring/requisitions/[id]/screening/ai`,
  `/api/hiring/settings/ai` (+ `limits`, `usage`, `test`), `/api/hiring/settings/general`.
- The insight target is fixed by kind (jd → requisition, fit → candidate, transcript → interview);
  running needs `hiring.manage` on that record, reading `hiring.view` plus the panel reveal.
- `/hiring/settings` (hiring admins; others get a read-only notice).

## Changes from Interview Hub

- CV parsing extracts only; it no longer scores. Scoring always goes through the redacted `fit`
  path (Interview Hub's parse-cv scored the raw, unredacted CV).
- The JD review no longer sends salary bands to the provider (they are comp-gated here).
- The stored insight and the interview analysis are scrubbed from audit (`aiOutput`, `aiAnalysis`).
- Streaming and the free `entityType` pair are not ported: three kinds, one completion each.

## Open questions

- Production has no AI provider configured; a hiring admin sets one in Hiring settings (or the
  operator sets `AI_PROVIDER`/`AI_BASE_URL`/`AI_MODEL`/`AI_API_KEY` on Vercel).

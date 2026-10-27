# ADR-085 — `unpdf` + `mammoth` for hiring document text, and a fetch-based hiring AI engine

Status: accepted (operator-authorised dependencies for the Hiring port, 2026-10-26) · Blueprint:
`docs/blueprints/hiring-ai.md`

## Context

Interview Hub reads uploaded CVs and job descriptions with AI: it pulls the text out on the server
and sends TEXT to the model, because OpenAI-compatible gateways (LiteLLM, vLLM) drop PDF parts
(its ADR-023). It used `unpdf` for PDFs and `mammoth` for Word files. HR Centre had neither, and
no AI engine the hiring module could use: `no-direct-anthropic-sdk` keeps the vendor SDK out, and
the brief asks for LiteLLM / OpenAI-compatible / Anthropic chosen in settings.

## Options

1. **`unpdf` 1.9.1 + `mammoth` 1.12.3** (MIT / BSD-2; what Interview Hub used). Both pure JS, both
   server-only (dynamic `import()` inside `lib/hiring/ai/text.ts`), no native binaries.
2. **`pdf-parse`** — unmaintained wrapper around an old pdf.js; known to read a test file at
   import time in serverless bundles.
3. **Send the PDF to the model** — works on Anthropic only; kept as the fallback for scanned PDFs
   where the provider is known to read them (`ai.pdfVision`).
4. **The Anthropic / OpenAI SDKs** — two vendor SDKs for two HTTP calls; the SDK rule forbids one.

## Decision

Option 1 for text, and a ~150-line `fetch` engine in `lib/hiring/ai/engine.ts` (Anthropic
Messages and OpenAI-compatible `/chat/completions`). Every call: egress check with DNS resolution
(no private, link-local or metadata hosts; https only), kill-switch and daily token/spend caps,
PII redaction on assessment paths, a deadline, `redirect: "manual"`, and a metering row.

## Consequences

- Two server-only dependencies; neither reaches a client bundle.
- The provider key is sealed with the hiring key (`HIRING_COMP_ENCRYPTION_KEY`, AAD
  `hiring:setting:ai.apiKey:value`) and stored as `{ apiKey }` so the audit scrub redacts it.
  Rotating that key without re-entering the AI key turns AI off (honestly), never on with junk.
- With no key, every AI affordance shows a disabled state and the routes answer 503 with a
  sentence; nothing leaves the deployment until an admin opts in.

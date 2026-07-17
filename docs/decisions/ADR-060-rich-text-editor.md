# ADR-060 — Rich-text editor: adopt Tiptap when a fork needs one (entry ahead of build)

**Status:** Accepted (2026-07-17) — as a **deferred** adoption. This ADR + the
`docs/build-vs-buy-ledger.md` entry are the recorded decision; nothing is installed yet
(no `@tiptap/*` dependency ships). A fork that actually needs a rich-text field runs
`/adopt "rich-text editor"`, lands the `lib/editor/**` seam, and flips this ADR to
"Accepted (built)".
**Date:** 2026-07-17
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Relates to:** ADR-032 (build-vs-buy gate), ADR-029 (shadcn/Radix UI layer), V2-306
(`/adopt` + OSS catalog — this ADR is the worked demonstration of that skill).

## Context

This ADR is the **worked demonstration of `/adopt` (V2-306)**: run the skill on a real,
plausible gap — a rich-text editor (comment bodies, note fields, description fields with
formatting) — and show the artifacts it produces without a wasteful install. The baseline
ships plain `<textarea>` / shadcn `Input`; nothing renders or edits formatted content.

## Decision drivers

- Reuse-first: is there an in-stack primitive? No — shadcn/Radix has no editor.
- License + weight: a rich-text editor is a runtime dep > 50 KB (CLAUDE.md Ask-before →
  this ADR).
- Ownership: the content is user data; the editor must self-host (no third-party service).

## Options considered (the `/adopt` catalog lookup + AskUserQuestion)

| Option                   | Note                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| **Tiptap** (MIT)         | Headless ProseMirror wrapper; composes with the token/theme layer; the catalog's OSS default. |
| **Lexical** (MIT, Meta)  | Capable, heavier mental model; less ecosystem for shadcn-style theming.                       |
| **Build on ProseMirror** | Full control, high maintenance surface — the drift the gate exists to stop.                   |
| **Plain textarea**       | The current default; fine until a fork genuinely needs formatting.                            |

## Decision

**Adopt Tiptap (MIT, headless) when a fork needs a rich-text field** — a thin
`lib/editor/**` seam (schema + sanitize-on-save) behind a `components/shared/RichText*`
primitive on the existing token layer; sanitize server-side (stored HTML is Restricted-
adjacent — no raw HTML to the DB without a zod-validated allowlist). Deferred until the
need is real; recorded now so the gate is ready and the next agent inherits the decision.

## Consequences

- **+** A fork adds a formatted field via `/adopt` with the license/weight/self-host call
  already made and the seam shape defined.
- **−** Deferred, so the seam isn't battle-tested until first use; sanitize/XSS handling
  is the load-bearing risk to design at build time (SECURITY.md).

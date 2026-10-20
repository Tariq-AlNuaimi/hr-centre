# Blueprint — evidence attached to a year-end self-assessment (§7.1)

Scope: app/api/year-end/evidence/**, lib/pms/evidence.ts, lib/storage.ts, lib/validations/evidence.ts, components/pms/KpiEvidence.tsx

**Status:** approved to build (operator, 2026-10-20 — "private Vercel Blob, that file type
allowlist, 10 MB per file and 10 files per KPI"; evidence classified **Confidential**).
**Builds on:** `docs/blueprints/year-end-self-assessment.md` (§7.1's employee surface).

## Problem

Today a self-assessment is a rating plus an optional comment. An employee claiming "Exceeded the
agreed target" has nowhere to put the thing that shows it, and a manager reviewing has nothing to
review but an assertion. HR asked for evidence per KPI, and asked for it to be **required** — a
rating with nothing behind it is the state this closes.

## Requirements (confirmed by HR, 2026-10-20)

1. Evidence is **required for every KPI**. The employee cannot submit (sign) until every KPI has a
   rating **and** at least one evidence item.
2. **Files and links**, multiple items per KPI.
3. Visible to **the employee, their direct manager (including during review), and HR**. Nobody else.
4. The **manager can comment** on a KPI's evidence.
5. The employee may **add or remove evidence until they sign**. After manager review, any change is
   audited.
6. Missing evidence at the deadline falls through to the **existing lock and escalation** (§5.4 /
   §5.5), with HR flagged. No new escalation path.

## Decisions (operator-confirmed)

| Question       | Answer                                                                           | Why                                                                                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage        | **Vercel Blob, `access: "private"`**                                             | These are performance records. A public URL is a permanent unauthenticated handle to one, and the `/scale-up` recipe's `access: "public"` is disqualifying. Private stores require auth on every read and write. |
| Reads          | Our own route → permission check → **short-lived signed URL** (5 min) → redirect | The blob pathname is random, but randomness is not the control: the control is that the only way to obtain a URL is a route that checked §4.2 first.                                                             |
| File types     | `pdf png jpg jpeg webp docx xlsx pptx csv txt md`                                | Allowlist, never a denylist. No `svg` (executes script), no archives, no `html`.                                                                                                                                 |
| Type check     | **Magic bytes**, not the extension or the client's `Content-Type`                | Both are attacker-controlled. A `.pdf` that is really HTML is the whole attack.                                                                                                                                  |
| Size           | **10 MB per file, 10 items per KPI**                                             | 10 MB holds a scanned PDF or a screenshot set without inviting video. The per-KPI cap matters as much: without it, "required evidence" is an unbounded write path.                                               |
| Upload path    | **Client upload** (`@vercel/blob/client`), token minted server-side              | Vercel functions cap request bodies at ~4.5 MB, so a 10 MB server upload cannot fit. The function never holds the bytes; the token callback is where the rules are enforced.                                     |
| Classification | **Confidential** (SECURITY.md §1)                                                | "Disclosure harms individuals". Not Restricted — that tier is secrets and salary, and over-classifying forces scrubbing that makes the feature unusable.                                                         |

## User stories

- **As an employee**, I want to attach the document or link that backs each rating, so my
  self-assessment is a claim with something behind it.
- **As an employee**, I want to fix a mistake — remove the wrong file, add the right one — up until
  I sign.
- **As a manager**, I want to see the evidence while I review, and say something about it.
- **As HR**, I want evidence to be part of the record, not an email attachment nobody can find.

## Scenarios

### Happy path

The year-end window is open and the baseline is approved. For each KPI the employee picks a level,
optionally comments, and attaches at least one file or link. Sign stays disabled, with the reason
named, until every KPI has both. After she signs, her manager sees every item while reviewing and
can comment on it.

### Worst paths

| What happens                                             | What the system does                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A `.exe` renamed `report.pdf`                            | Refused. The magic bytes decide, not the name.                                                                                         |
| An 11 MB file                                            | Refused before upload, by the token callback — the bytes never leave the browser.                                                      |
| An 11th item on one KPI                                  | Refused with the count, not a generic error.                                                                                           |
| A link of `javascript:alert(1)`                          | Refused. `http(s)` only.                                                                                                               |
| A peer, or a skip-level manager, opens an evidence URL   | **404, not 403.** `canViewEmployee` already refuses outside the chain, and 403 would confirm the item exists.                          |
| The employee removes evidence after the manager reviewed | Allowed until she signs, and **audited** — who, when, what.                                                                            |
| Evidence missing at the deadline                         | §5.4 locks the stage and §5.5's ladder escalates, exactly as for a missing rating. HR is flagged by the existing sweep. No new path.   |
| A signed URL is forwarded to someone else                | It expires in 5 minutes, and re-fetching requires passing the permission check again. The window is not zero; it is bounded and short. |
| The Blob store does not exist yet                        | Upload fails with a sentence naming the missing configuration, rather than a stack trace. The rest of the assessment keeps working.    |

## Architecture

- **`KpiEvidence`** — `kpiId`, `kind` (`FILE` | `LINK`), `label`, `blobPathname` (files),
  `url` (links), `contentType`, `sizeBytes`, `uploadedByEmployeeId`, `managerComment`,
  soft-delete columns. Soft-delete so a removal is reversible and §6.3-style history survives.
- **`lib/storage.ts`** — the only module that talks to `@vercel/blob`. Private access is set here,
  once, so no call site can choose `public`.
- **`lib/pms/evidence.ts`** — the pure rules: the type allowlist, the size and count caps, the link
  scheme check, and `evidenceBlockedReason` / `signBlockedReason`. Testable without a network or a
  database, which is where the enforcement lives.
- **Routes** under `app/api/year-end/evidence/**` — mint an upload token, list, read (permission →
  signed URL → redirect), delete, and the manager's comment.
- **UI** — `components/pms/KpiEvidence.tsx`, rendered inside each KPI on the existing assessment
  screen. Read-only for anyone who is not the owner.

**Permission is not re-invented.** `canViewEmployee` decides who may see an item, the same function
the rest of §4.2 uses; the owner check for writes is the same shape as `acknowledgeBlockedReason`'s.

## Open questions

1. **Retention.** Performance evidence presumably outlives the cycle, but nothing says for how
   long. The audit-purge job does not touch it today. Flagged, not decided.
2. **Virus scanning.** Not in scope and not available on this rail. Worth naming at `/handoff`:
   the files are served as attachments with `nosniff`, which stops them executing in our origin,
   but it is not malware scanning.
3. **Does a manager's evidence comment need to be visible to HR at calibration?** §10 does not
   mention evidence. Left visible to HR, since HR can already see the evidence itself.

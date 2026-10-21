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
   Operator-confirmed 2026-10-21, after the first build got this wrong: this is NARROWER than
   §4.2's general visibility rule, which lets any manager see anyone below them however deep and
   grants the executive viewer the whole org. `canViewEvidence` is the predicate; a rating follows
   §4.2, an evidence FILE does not, because a file can contain anything.
4. The **manager can comment** on a KPI's evidence.
5. The employee may **add or remove evidence until they sign**. After manager review, any change is
   audited.
6. Missing evidence at the deadline falls through to the **existing lock and escalation** (§5.4 /
   §5.5), with HR flagged. No new escalation path.

## Decisions (operator-confirmed)

| Question       | Answer                                                                           | Why                                                                                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage        | **Vercel Blob, `access: "private"`**                                             | These are performance records. A public URL is a permanent unauthenticated handle to one, and the `/scale-up` recipe's `access: "public"` is disqualifying. Private stores require auth on every read and write. |
| Reads          | Our own route → permission check → **short-lived signed URL** (5 min) → redirect | The blob pathname is random, but randomness is not the control: the control is that the only way to obtain a URL is a route that checked `canViewEvidence` first.                                                |
| File types     | `pdf png jpg jpeg webp docx xlsx pptx csv txt md`                                | Allowlist, never a denylist. No `svg` (executes script), no archives, no `html`.                                                                                                                                 |
| Type check     | **Magic bytes**, not the extension or the client's `Content-Type`                | Both are attacker-controlled. A `.pdf` that is really HTML is the whole attack.                                                                                                                                  |
| Size           | **10 MB per file, 10 items per KPI**                                             | 10 MB holds a scanned PDF or a screenshot set without inviting video. The per-KPI cap matters as much: without it, "required evidence" is an unbounded write path.                                               |
| Upload path    | **Preflight → client upload → confirm**, all three authenticated                 | Vercel functions cap request bodies at ~4.5 MB, so a 10 MB server upload cannot fit. The function never holds the bytes; the token callback is where the rules are enforced.                                     |
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
| A `.exe` renamed `report.pdf`                            | Refused — at CONFIRM, after the bytes land, which is the first point the server can read them. Deleted, never recorded.                |
| An 11 MB file                                            | Refused before upload, by the token callback — the bytes never leave the browser.                                                      |
| A `.md` file the browser reports as `""`                 | Accepted. The extension picks which claim to check when `File.type` is absent or off-allowlist; the magic bytes still decide.          |
| An 11th item on one KPI                                  | Refused with the count, not a generic error.                                                                                           |
| A link of `javascript:alert(1)`                          | Refused. `http(s)` only.                                                                                                               |
| A peer, or a skip-level manager, opens an evidence URL   | **404, not 403.** `canViewEmployee` already refuses outside the chain, and 403 would confirm the item exists.                          |
| The employee removes evidence after the manager reviewed | Allowed until she signs, and **audited** — who, when, what.                                                                            |
| Evidence missing at the deadline                         | §5.4 locks the stage and §5.5's ladder escalates, exactly as for a missing rating. HR is flagged by the existing sweep. No new path.   |
| A signed URL is forwarded to someone else                | It expires in 5 minutes, and re-fetching requires passing the permission check again. The window is not zero; it is bounded and short. |
| The Blob store does not exist yet                        | The preflight answers **503** with the missing configuration named. Links keep working.                                                |
| A step fails for any reason                              | It is named ON THE PAGE, with the server's sentence and HTTP status. See "the flow has to be legible" below.                           |

## Architecture

- **`KpiEvidence`** — `kpiId`, `kind` (`FILE` | `LINK`), `label`, `blobPathname` (files),
  `url` (links), `contentType`, `sizeBytes`, `uploadedByEmployeeId`, `managerComment`,
  soft-delete columns. Soft-delete so a removal is reversible and §6.3-style history survives.
- **`lib/storage.ts`** — the only module that talks to `@vercel/blob`. Private access is set here,
  once, so no call site can choose `public`.
- **`lib/pms/evidence.ts`** — the pure rules: the type allowlist, the size and count caps, the link
  scheme check, and `evidenceBlockedReason` / `signBlockedReason`. Testable without a network or a
  database, which is where the enforcement lives.
- **Routes** under `app/api/year-end/evidence/**`. The attach flow is three authenticated calls on
  one POST, and the shape of it is load-bearing:
  1. **Preflight** (`{ preflight: true }`) — runs every rule and RETURNS the pathname the server
     will authorise. Two jobs: a refusal comes back as our own sentence and HTTP status (a refusal
     thrown inside the token callback travels back through the Blob SDK, which replaces both — the
     reason an operator saw "the picker opens and nothing happens"), and the pathname gets ONE
     author, so the client cannot propose a prefix the server's pin refuses.
  2. **Token** (Vercel's `{ type, payload }` handshake) — re-checks everything, because the
     preflight's answer is advice and a client may lie. `addRandomSuffix: false`, so the pathname
     confirmed is exactly the pathname authorised.
  3. **Confirm** — reads the stored bytes back, sniffs them, and creates the row.
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

## The flow has to be legible without a browser console

The operator tested on production, could not read the browser console, and
reported: _"the file picker opens, but no upload request reaches storage and
nothing appears under Evidence."_ Nothing on screen distinguished "refused",
"blocked", "crashed" and "saved but not displayed".

So the attach flow narrates itself into a list rendered beside the button —
choosing, checking the type, checking the size, asking permission, uploading,
verifying, saved — each line carrying its own outcome, the server's exact
sentence, and the HTTP status. It is a `role="status"` live region, so it
reaches a screen reader too, and it persists until the next attempt rather than
fading like a toast. A failure that reaches no surface is indistinguishable
from a feature that does nothing, and that is the state this closes.

Two failures are called out by name because neither leaves anything readable:
a fetch the browser never completes (`Failed to fetch`) is reported as a likely
**Content-Security-Policy `connect-src`** problem, and a dismissed picker is
reported as such rather than returning quietly.

## Correction log (2026-10-21)

The first build of this feature shipped with the file half non-functional and two of this
document's own claims false. Recorded here rather than quietly edited, because the pattern is the
useful part: **every one of these was a mechanism that existed with nothing correctly calling it**,
which is the third time this repo has produced that exact defect (§3.5's `enrolParticipants`,
§6.2's HR acknowledgment columns, §7.1's year-end door).

| What was claimed                                    | What was true                                                                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files upload to a private store                     | No file could upload at all. The client proposed `year-end/pending/<name>`; the server pins uploads to `year-end/<participantId>/<kpiId>/`. The pin was right, the caller was never updated to match.         |
| The magic bytes decide                              | The sniffer ran in Vercel's `onUploadCompleted` — a server-to-server POST with no session, which this app answers 401 to in middleware AND in `withAuth`. The row, the sniff and the delete were unreachable. |
| Evidence is visible to the direct manager and HR    | Both the read route and the shared select used `canViewEmployee`, so the whole downward chain and the COO could read the files. Fixed by `canViewEvidence`.                                                   |
| Served `Content-Disposition: attachment`            | Never implemented, and could not be: headers on our 302 do not bind the cross-origin Blob response. Withdrawn in ADR-073.                                                                                     |
| Missing evidence falls through to the existing lock | `evidenceWriteBlockedReason` checked only ownership and signature. An employee past the deadline — who therefore can never sign — could add and delete evidence through calibration. Now §5.4 applies.        |
| The manager comments on an item                     | `canActOnEmployee` returns true for HR, and there is no author column, so an HR user could post a note rendered as "Manager's note". Now the direct manager only.                                             |

Two further defects, found when the operator reported that files still did
nothing — and both of them silent by construction:

| What was claimed                      | What was true                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The employee can pick an allowed file | `accept` listed MIME types only. The OS decides whether a file matches `text/markdown` or `text/csv`, so on most machines `.md` and `.csv` grey out in the picker: the dialog opens, nothing can be selected, `onChange` never fires, and NO CODE RUNS to report it. Extensions are now listed too.                                          |
| A saved item appears under Evidence   | Every write called `router.refresh()` alone. That re-renders the manager's server-component page, but the employee's own page reads `/api/year-end/me` through TanStack Query, which `router.refresh()` does not touch — so a row could be written and audited and never appear until a manual reload. The query is now invalidated as well. |

**Still not verified against a real Blob store**, and the only honest statement about it: the
container this was built in cannot resolve `vercel.com`, read npm, or read `node_modules`, so the
upload wire protocol — the exact CSP host, the handshake response shape, what `upload()` resolves
with — is reasoned from the code and not confirmed. The failure modes are therefore made legible
instead of silent: the client names which leg failed, the CSP comment says to read the blocked
origin out of the browser console, and the confirm route distinguishes "could not read it back"
(502) from "contents do not match" (415).

## Open questions

4. **Soft-deleted evidence is not registered** in `SOFT_DELETE_MODELS` or
   `RECYCLABLE_ENTITY_TYPES`; every reader filters `deletedAt: null` by hand (all four verified).
   Registering it means touching `lib/prisma/**`, which is Ask-before — deliberately not done
   unasked.
5. **Nothing garbage-collects orphan blobs.** Dropping Vercel's completion callback (see above)
   trades an unauthenticated public API path for a window where bytes can land without a row, if
   the browser dies mid-confirm. An orphan blob is invisible to every screen; an orphan row would
   be a lie about the record. A sweep belongs with the retention decision in question 1.

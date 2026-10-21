# ADR-073 — §7.1 evidence lives in a PRIVATE blob store, reached only through a checked route

**Status:** Accepted
**Date:** 2026-10-20
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** Claude (implementation, operator-directed)

## Context

HR asked for evidence on a year-end self-assessment: files and links, required on every KPI,
visible to the employee, their direct manager and HR. The operator's constraint was explicit —
_"these files are performance records for employees, so storage must be private, with no public
URLs"_.

The fork's own `/scale-up` recipe for file uploads hardcodes `access: "public"`. For a photo on a
marketing page that is fine. For a document an employee uploads to argue their own performance
rating it is not: a public blob URL is a permanent, unauthenticated handle, and it cannot be
un-published once it has been copied into a chat message or a browser history.

## Decision drivers

- **A public URL is unrecoverable.** Every other control in this system — `canViewEmployee`,
  the audit trail, the salary column's entitlement check — can be tightened later. A leaked
  public URL cannot.
- **The signature must be the LAST step of an authorised read, never the authorisation.**
- **The uploader chooses the filename and the `Content-Type`.** Neither is evidence of anything.
- **Vercel functions cap a request body at ~4.5 MB** and the agreed limit is 10 MB, so the bytes
  cannot pass through a route handler at all.

## Decision

**A private Vercel Blob store**, with every read mediated by
`GET /api/year-end/evidence/[id]`: §4.2's `canViewEmployee` runs first, and only then is a signed
URL minted — read-only, one pathname, **five minutes**. A caller outside the chain gets 404, not
403, so the response cannot confirm the item exists.

Four details that are load-bearing, each of which was wrong in a first draft of this work:

1. **The browser proposes the upload pathname.** Vercel's client-upload protocol has the client
   name the path and the server approve a token for it. Without a constraint, an employee could
   request a token for another employee's folder. `isWithinEvidencePrefix` pins the path to the
   KPI the server just authorised, and `addRandomSuffix` stops two uploads colliding.
2. **The magic-byte check needed a caller.** The rule was written, the blueprint claimed it, and
   nothing invoked it — in a client-upload flow the server never sees the bytes in transit. The
   check now runs in `onUploadCompleted`, which is the first moment the bytes exist: a file whose
   contents do not match what it claimed is **deleted and never recorded**.
3. **The client call must declare `private` too.** A first draft declared `"public"` with a comment
   asserting the server overrode it. The server sets what the _token_ grants, not what the client
   declares, so that mismatch would have surfaced only against a real store.
4. **The `/ship` assertion must ignore comments.** The first version of the "never public" test
   failed on `lib/storage.ts`'s own header explaining why public was rejected.

## Considered options

- **Vercel Blob, private (chosen).** The `/scale-up` package, the same vendor as the deploy rail,
  `BLOB_READ_WRITE_TOKEN` injected rather than another secret to hand over at `/handoff`. Private
  stores and `issueSignedToken`/`presignUrl` are GA, and were verified present in 2.8.2 before
  adopting rather than taken from the docs.
- **Postgres `bytea`.** One backup, one access path — genuinely attractive for records like these.
  Rejected: file bytes through Neon's pool, and every dump carries them.
- **S3 / R2.** A much larger dependency plus a bucket policy and CORS to get wrong, buying
  portability nobody asked for. The presigned-GET model is the same one adopted here.
- **A third-party uploader (UploadThing, Uploadcare).** Rejected: a processor holding employee
  performance records is a data-protection question the operator has not been asked.

## Consequences

- Evidence is **Confidential** (SECURITY.md §1), with the row recorded there.
- Files need a Blob store; **links do not**. An unconfigured store degrades the feature and says
  so, rather than breaking the assessment.
- ~~Served `Content-Disposition: attachment` with `nosniff`~~ — **withdrawn as written.** The
  redirect sets `nosniff`, but headers on a 302 do not bind the cross-origin Blob response the
  browser follows it to, and no disposition was ever set. The real constraints are the private
  store, the content type pinned on the token, and the five-minute single-pathname signature.
  Left in place rather than deleted, because a control a record claims and does not have is
  worse than one it never claimed: an uploaded file cannot render as a
  page in this origin.
- **Not closed:** no malware scanning — named in the blueprint's open questions and worth raising
  at `/handoff`. And a signed URL forwarded within its five minutes works for whoever holds it;
  the window is bounded, not zero.
- **Retention is undecided.** The audit purge does not touch evidence, and nothing says how long a
  performance record should live. Flagged, not answered.

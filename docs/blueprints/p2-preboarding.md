# P2 — Joiner preboarding (token link, form, reminders)

Scope: prisma/schema.prisma, prisma/migrations/*_p2_jml_preboarding/**, tests/contracts/hive-public-surface.test.ts, lib/jml/preboarding/**, lib/validations/jml/preboarding.ts, lib/jml/sweep.ts, lib/jml/join/retention.ts, app/api/jml/cases/[id]/preboarding/route.ts, app/api/jml/cases/[id]/preboarding/photo/route.ts, app/api/preboarding/[token]/route.ts, app/api/preboarding/[token]/photo/route.ts, app/[locale]/(joiner)/preboarding/[token]/page.tsx, app/[locale]/(joiner)/layout.tsx, components/jml/preboarding/**, components/jml/case/**, i18n/route-decision.ts, eslint-rules/rules/no-bare-api-route.mjs, messages/**, tests/contracts/p2-preboarding.test.ts, docs/decisions/ADR-093-joiner-preboarding-public-link.md

Status: operator-approved P2 roadmap (2026-10-29), public path authorised. Source: UX audit
`performance-jml.md` P2-4. Decision: ADR-093. Benchmarks: BambooHR New Hire Packet / Get to Know
You (reminders 2w/1w/3d), HiBob preboarding.

## Stories and acceptance criteria

- **US-1 (HR) send a preboarding link.** AC-1.1 On a JOIN case whose joiner is still
  `PRE_JOINER` and whose case is open, an HR user with `jml.manageJoiners` in scope can create a
  link (shown once to copy) or, when SMTP is configured and a personal email exists, email it.
  AC-1.2 The link expires at the end of the planned start day (between 3 and 60 days out) and HR
  can revoke every live link. AC-1.3 Out-of-scope cases answer 404 (`loadCaseFor`).
- **US-2 (joiner) fill it in without an account.** AC-2.1 `/preboarding/<token>` shows first name,
  company, start date and HR contact — nothing else about the case. AC-2.2 Introduction and hobbies
  (≤ 500 characters each), a documents checklist (Civil ID, passport, qualification, ROP clearance:
  sent / will bring / does not apply), and a JPEG/PNG picture under 2 MB. AC-2.3 Without Blob the
  picture section is a disabled note ("bring one on your first day"). AC-2.4 Re-submitting
  replaces the answers until day one.
- **US-3 (HR) the tasks complete themselves.** AC-3.1 Submitting with an introduction or hobbies
  completes T09; uploading a picture completes T08 (system completion, gates respected, a comment
  says where it came from). AC-3.2 Document answers are noted on T04–T07 and complete nothing.
  AC-3.3 The HR owner gets a bell when the form is completed or updated; the case shows the answers
  and a "View picture" link (signed, short-lived).
- **US-4 (HR) reminders.** AC-4.1 At 10, 5 and 2 working days before the planned start (core
  calendar), at 09:00 local, a joiner with a live link who has not submitted triggers a bell to the
  HR owner and, with SMTP, an email with a fresh link.
- **Privacy.** AC-5.1 Anonymising the joiner case deletes the preboarding row and the picture.
  AC-5.2 No ID numbers, no ID document files (ADR-078).

## Worst paths

- Malformed, unknown, expired, revoked token; case cancelled/completed/archived; joiner already
  started → the same "This link is no longer valid" page / 404, distinguishing nothing.
- Brute force → per-IP (60/min) and per-token (10/min form, 5/min picture) limits; 43-char tokens.
- Oversized or wrong-type picture → refused before storage (content-length and type checks).
- Storage not configured → 503 from the photo route; the form never offers the upload.
- Template without T08/T09 (customised) → nothing completes, nothing fails.
- No `AUTH_URL` → the link is built from HR's own browser origin; reminder emails are skipped.

## Data

`jml_preboarding` (one row per JOIN case): link issued/expiry, submitted at, picture pathname/type/
uploaded at, documents JSON, reminder count/last. Introduction and hobbies stay on
`jml_join_details`. Links: `core_magic_links` purpose `jml-preboarding`, subject = case id.

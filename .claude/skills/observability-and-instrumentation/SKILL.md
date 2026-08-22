---
name: observability-and-instrumentation
description: Instruments a feature with this repo's own primitives -- tracing, error capture, structured non-secret logs -- as it's built, not after. Use when adding logging or tracing, wiring an alert, or when you can't tell what happened in production and need to debug an incident after the fact.
---

# Observability and Instrumentation

> Adapted from [agent-skills](https://github.com/addyosmani/agent-skills) (`observability-and-instrumentation`, MIT), rewritten against this template's primitives per ADR-022.

## Overview

This repo's Operate phase measured **zero skills invoked and zero lines changed** for
production visibility. A routing probe of "add logging so we can debug this in
production" ranked `/ship` the top match at a confidence of **0.06** — nothing in the
repo actually owned the request. Meanwhile `grep` for `withSpan`/`captureError` call
sites outside their own definitions turns up **none**, and `console.error` appears in
exactly one route. The primitives exist (`lib/observability`, `lib/sentry.ts`,
`@vercel/otel`, `@sentry/nextjs` — ADR-002, ADR-040); nothing calls them.

Code you can't observe is code you can't operate. Instrumentation is not a
post-launch add-on — it's written **alongside** the feature, the same way tests are
(`test-driven-development`). A feature that ships without telemetry turns its first
bug report into archaeology: no span, no scrubbed error context, no structured log —
just "it doesn't work" and a blank dashboard.

This skill is the **discipline**: when to add a span, what to hand `captureError`,
what a structured log line looks like here, and where the line sits against this
repo's security floor. `/scale-up` item 8 is the **shopping list** (Sentry env vars
already wired, when to point `OTEL_EXPORTER_OTLP_ENDPOINT` at a collector) — it tells
you what to turn on. This skill tells you what to actually write once it's on.

## When to use

- Writing a new API route, service function, or background/cron job that does I/O,
  calls an external provider, or can fail in a way a user or on-call will ask about
- A PR adds retries, a queue, or a cross-service/external call with no new telemetry
- Someone says "why did this fail in production" and the honest answer is "we can't
  tell" — that gap is what this skill prevents next time, not what it debugges now
- Reviewing your own diff before `/code-review` on anything touching `app/api/**`
  or `lib/**`

**NOT for:**

- Diagnosing a failure happening right now, with a live stack trace or failing
  `/ship` step in front of you — use `debugging-and-error-recovery` (good
  instrumentation is what makes that skill fast next session)
- Deciding _whether_ to turn Sentry/OTel on, or picking env vars — that's
  `/scale-up` item 8 and `/first-fork`'s optional extras
- Auditing who-changed-what on a Prisma model — that's the audit extension
  (`docs/rules/prisma.md`), already automatic; don't reinvent it with ad hoc logs

## Steps

### 1. Name the on-call question before writing code

Telemetry without a question is noise. Before touching a route or service, write
down 2–3 things you'd need to answer if this broke at 2am:

```
FEATURE: password-reset email delivery
QUESTIONS:
1. Did the email actually attempt to send, and did it succeed?
2. If it failed, was it SMTP config, the provider, or a thrown exception?
3. Is this route slow, and where — token lookup, hashing, or the mail call?
```

If you can't name the questions, you're not ready to instrument — you'll wrap
everything in `try/catch` and learn nothing when it fires.

### 2. Reach for what's already wired — don't invent a stack

This repo ships exactly three telemetry primitives. Use them; don't add pino,
winston, or a second tracing SDK.

| Need                              | Primitive                          | Where                                  |
| --------------------------------- | ---------------------------------- | -------------------------------------- |
| "Where did time go?"              | `withSpan(name, fn)`               | `lib/observability/index.ts` (ADR-040) |
| "What broke, with safe context?"  | `captureError(err, context)`       | `lib/sentry.ts` (ADR-002)              |
| "What happened in this one case?" | Structured `console.error`/`.warn` | inline, at the failure site            |

`withSpan` wraps a unit of work in an OTel span and is a genuine no-op when
`OTEL_EXPORTER_OTLP_ENDPOINT` is unset — wrap the service call unconditionally,
the backbone decides at runtime whether anything is exported:

```typescript
import { withSpan } from "@/lib/observability";

const result = await withSpan("password-reset.send-email", () =>
  sendEmail({ to: email, subject, text, html }),
);
```

`captureError` — never `Sentry.captureException` directly — scrubs `SCRUB_FIELDS`
from the context object before it leaves the process:

```typescript
import { captureError } from "@/lib/sentry";

try {
  await sendEmail({ to: email, subject, text, html });
} catch (err) {
  captureError(err, { route: "forgot-password", stage: "send-email" });
}
```

For a one-off "this specific case failed" signal that doesn't need a full span or
Sentry round-trip, a structured `console.error` matching the existing pattern in
`app/api/auth/forgot-password/route.ts` is fine — an object with a stable field
set, never a template string:

```typescript
// GOOD — queryable fields, matches the repo's existing convention
console.error("forgot-password: async reset delivery failed", {
  name: err instanceof Error ? err.name : "Unknown",
});

// BAD — unqueryable prose, and an easy place to interpolate something Restricted
console.error(`reset delivery failed for ${email}: ${err}`);
```

### 3. Pick signal by question, not by habit

- **"How often / how bad, in aggregate?"** → a span's duration + status, viewed in
  the OTel backend once `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Don't hand-roll a
  metrics library on top.
- **"Where in this one request did it go wrong?"** → `withSpan` around each
  meaningful sub-step (the DB call, the external API call), not one span around
  the whole handler.
- **"What broke, right now, for a human to look at?"** → `captureError` with a
  small, named context object (`route`, `stage`, an id) — not the raw request body.

### 4. Never let telemetry become a leak

Every log line, span attribute, and error context object is a data-egress
surface — what you log leaves the process, and Sentry DSNs / OTel collectors are
external by design. **If this discipline ever conflicts with the security floor,
the floor wins, full stop:**

- **Never log a Restricted env var** — `AUTH_SECRET`, `SMTP_PASSWORD`,
  `CRON_SECRET`, `AI_API_KEY`, any `*_TOKEN`/`*_SECRET`/`*_KEY`/`*_URL` credential.
  Enforced at `error` by the `no-secret-env-in-console` ESLint rule; it fires on
  `console.*` **and** any method named like a log level, not console alone.
- **`lib/email.ts` logs metadata only** — recipient count, subject, message id —
  and **never** `opts.text` / `opts.html`. Those bodies can carry one-time
  secrets (reset tokens, OTPs). Match that pattern in your own context objects:
  log that an email was attempted, never its content.
- **Restricted / Confidential data classes are defined in `SECURITY.md` §1.**
  `SCRUB_FIELDS` (`lib/prisma/audit-extension.ts`) is what `captureError` scrubs
  by name-matching keys — it protects field _names_ it knows about, not every
  shape you might pass. Don't hand it a raw Prisma row or request body as
  context; pick the specific fields you actually need to debug.
- **`no-restricted-export-column` and the audit extension already exist** for
  write-side data protection — this skill is about _ad hoc_ telemetry you add
  yourself, which has no scrubbing gate except the one you write into the call
  site. Treat every argument to `console.*`/`captureError`/a span attribute as
  something that will be read by someone outside the app.

If a suppression is ever genuinely needed, it's a single-line disable plus a
`SECURITY.md` §12 entry (CLAUDE.md "Hard rules") — never a blanket rule change.

### 5. Verify the telemetry itself, before calling it done

Instrumentation is code; it can be silently wrong. Trigger the path and look at
the actual output — see Verification below.

## Common Rationalizations

| Rationalization                                                   | Reality                                                                                                                                                                                      |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "I'll add logging when something breaks"                          | That's exactly when it's too late — the bug already happened uninstrumented, and now you're debugging blind _and_ adding telemetry at the same time.                                         |
| "console.log is fine, it's just a quick fix"                      | An unstructured string can't be filtered or correlated later, and it's the easiest place to accidentally interpolate a token or password. Five extra minutes now, one grep later.            |
| "It's wrapped in try/catch, so it's handled"                      | Handled ≠ observed. A swallowed catch with no `captureError` is a failure nobody will ever see.                                                                                              |
| "Sentry/OTel isn't configured on this fork, so it doesn't matter" | `withSpan` and `captureError` are safe no-ops when unconfigured (AC-5.1) — call them anyway. The moment a project turns the endpoint on, every already-instrumented path lights up for free. |
| "This route is too simple to need telemetry"                      | Simple routes are also the ones nobody thinks to check first when they're the actual cause.                                                                                                  |
| "I'll just log the whole request body, it's easier"               | That's how a Restricted field ends up in a log line. Pick named fields; `no-secret-env-in-console` catches env vars, not a raw body dump.                                                    |
| "The audit log already covers this"                               | The audit extension records Prisma writes for compliance, not "why did this external call fail." They answer different questions — you likely need both.                                     |

## Red Flags

- A new route/service with retries, an external call, or a queue and zero
  `withSpan`/`captureError`/structured log at the failure points
- `console.error`/`.warn` built with a template string instead of an object with
  stable field names
- A `catch` block that only rethrows or swallows, with nothing sent to
  `captureError`
- Any Restricted env var, `opts.text`/`opts.html`, or raw request body reaching a
  log call, span attribute, or `captureError` context — check for this explicitly,
  don't rely on the ESLint rule to catch everything (it only matches known env-var
  name patterns)
- A `context` object passed to `captureError` that is an entire Prisma row instead
  of the two or three fields actually needed
- "It works locally" offered as the only evidence a production path is healthy

## Verification

Before calling a feature's instrumentation done, confirm — with evidence, not by
inspection alone:

- [ ] The 2–3 on-call questions for this feature are written down (in the PR
      description or a code comment), and each new signal maps to one
- [ ] Every meaningful external call / DB round-trip / retry loop is wrapped in
      `withSpan` with a descriptive, hierarchical name (`"feature.step"`)
- [ ] Every caught error on a path that matters reaches `captureError` with a
      small, named context object — not the bare `err` alone, not a raw row
- [ ] Any ad hoc `console.*` call uses a structured object with a stable message
      prefix and field names, matching the `forgot-password` route's pattern
- [ ] Grepped the diff for `process.env.` / `opts.text` / `opts.html` / raw
      request bodies reaching any log, span attribute, or `captureError` call —
      none found
- [ ] Forced the failure path locally (bad SMTP config, a thrown error, a timeout)
      and confirmed a span/error/log actually appears with the expected fields —
      not just that the code compiles
- [ ] `npm run lint` passes with `no-secret-env-in-console` clean on the touched
      files (it fails the `error` level, not a warning, if it fires)

## Related

- `docs/rules/api-routes.md` — the auth-wrapper + zod boundary every route needs
  regardless of telemetry
- `docs/rules/prisma.md` — the audit extension and `SCRUB_FIELDS`; don't duplicate
  write-side audit logging with your own log lines
- `/scale-up` (item 8) — the on/off switch and env vars for Sentry/OTel; this
  skill assumes the switch and covers what to write once it's flipped
- `sre` agent — the operational-readiness **reviewer**; it checks, after the
  fact, whether observability/failure-modes/rate-limits/rollback/runbook are
  sound. This skill is the **build-time practice** that gives it something to
  find green
- `debugging-and-error-recovery` — for a failure happening right now; this skill
  is what makes that one fast next time
- `/code-review` and the `senior-code-reviewer` agent — run after any push
  touching `app/api/**` or `lib/**`; missing telemetry on a risky path is a
  legitimate finding for both

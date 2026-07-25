# Recipe: Uptime monitoring

> `/scale-up` → ops item. OPEN-ITEMS **#18**.
> Points an external monitor at the health endpoint this template **already ships**, so an
> outage pages a human instead of being discovered by a stakeholder opening the shared URL.

## When to add it

Add this when the fork stops being disposable:

- Non-dev stakeholders rely on the URL (the template's whole point — see CLAUDE.md), so
  "it's down and nobody noticed" is a real failure.
- It's approaching `/handoff` — SECURITY.md/ops readiness expects _someone_ is watching.
- It has a custom domain or a paying/blocking audience.

**Don't** add it to a throwaway prototype. A monitor that nobody is on-call for is noise,
not observability.

## What the template already gives you

`app/api/health/route.ts` — **already built, already public**, no work needed:

- **Unauthenticated** by design: `/api/health` is in the public-path list
  (`i18n/route-decision.ts`), so a monitor reaches it without credentials.
- **Checks the database**, not just the process: it runs `SELECT 1` through Prisma. A
  Next.js app whose DB is unreachable is _down_ for every real purpose, and a naive
  `GET /` check would still return 200.
- **Honest status codes**: `200` with `{status:"ok"}` when the DB answers; **`503`** with
  `{status:"degraded"}` when it doesn't. Any monitor that treats non-2xx as down works
  with no custom parsing.
- Returns a `timestamp` so a stale cached response is detectable.

Verify it yourself before wiring anything:

```bash
curl -i https://<your-app>/api/health
# 200 {"status":"ok","checks":{"db":"ok"},"timestamp":"..."}
```

## Deps

**None.** This is configuration in a third-party monitor, not code. That is deliberate —
an in-app uptime checker cannot report that the app is down, because it is the thing that
is down. Monitoring must be **out-of-process and off-host**.

## Pick a monitor

Any HTTP monitor works; the endpoint is standard. Ordered by fit for this rail:

| Option                         | Free tier                 | Why / why not                                                                                                  |
| ------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Better Stack** (Uptime)      | 10 monitors, 3-min checks | Best fit: status pages + on-call escalation in one product; reads a JSON body if you want field-level asserts. |
| **UptimeRobot**                | 50 monitors, 5-min checks | Simplest and most generous; no on-call routing on free.                                                        |
| **Checkly**                    | limited                   | Best if you want browser checks (a real login flow) as well as HTTP.                                           |
| **Vercel Log Drains + alerts** | paid                      | Already in the rail, but log-based alerting is reactive; it won't catch "the whole deployment is gone".        |

**Self-hosted alternative — Uptime Kuma** (`louislam/uptime-kuma`, MIT): run it on any box
you already own. Only sensible if that box is genuinely independent of the app's
infrastructure; monitoring your Vercel app from a container on the same account defeats it.

## Configure the check

Whichever you pick, the settings that matter:

- **URL**: `https://<your-app>/api/health`
- **Interval**: 3–5 min is plenty (a prototype rail does not need 30s).
- **Expect**: HTTP `200`. Optionally assert the body contains `"status":"ok"` — this
  catches a _degraded_ 503 explicitly rather than lumping it with a timeout.
- **Alert after 2 consecutive failures**, not 1. Serverless cold starts and brief Neon
  wake-ups produce single-sample blips; alerting on one sample trains you to ignore pages.
- **Timeout**: ≥ 10s. A Neon free-tier database can be **suspended** and take seconds to
  wake — a 2s timeout will page you for a healthy app.

## The Neon free-tier trap (read this)

On the Neon free tier the database **auto-suspends when idle**. A monitor hitting
`/api/health` every 3 minutes will keep it permanently awake, which:

1. changes the app's behaviour (you stop ever seeing cold-start latency yourself), and
2. burns compute hours that the free tier meters.

Decide deliberately:

- **Fine, keep it warm** — the monitor doubles as a keep-alive. Common and reasonable for
  a shared internal tool; just know you chose it.
- **Don't keep it warm** — monitor at a longer interval (15+ min) and raise the timeout,
  accepting slower outage detection in exchange for real idle behaviour.

## Don't page yourself for planned deploys

`git push` deploys (ADR-006), and a deployment can briefly fail a check. Either set a
maintenance window / pause the monitor around large migrations, or keep the
2-consecutive-failures rule above, which absorbs a normal rollout.

## What this does NOT cover

Uptime monitoring answers "is it up?" — not "is it correct?" or "is it slow?". It will not
catch a broken permission check, a silently failing cron, or a p95 regression. Those are
Sentry (already wired, opt-in via DSN), the audit log, and the perf recipes respectively.

## Verification status

**Not executed here** — this recipe is configuration in a third-party SaaS that requires an
account this container has no credentials for, and monitoring the local dev server from
inside the same container would prove nothing. What _was_ verified: the health endpoint it
targets exists, is on the public-path allowlist (`i18n/route-decision.ts`), performs a real
DB check, and returns 200/503 accordingly (`app/api/health/route.ts`, read 2026-07-25).

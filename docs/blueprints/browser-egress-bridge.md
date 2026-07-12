# Blueprint — browser-egress bridge (mitmproxy chain for headless Chromium in web sessions)

Scope: scripts/browser-bridge.mjs, Makefile, .mcp.json, .claude/skills/design-qa/SKILL.md, .claude/skills/uat/SKILL.md, .claude/skills/manual-uat/SKILL.md

> No new `app/api/**/route.ts` or `app/**/page.tsx` (nothing for the `blueprint-gate.mjs`
> ADR-033 hook to match) and no new `lib/**` capability (nothing for the `build-vs-buy-gate.mjs`
> ADR-032 hook to match — `scripts/` is exempt). This is a full-track blueprint because the
> change touches the `.claude/` harness (Ask-before surface) and the wired MCP servers.
> Governance of record: the authoritative runbook `docs/runbooks/browser-egress-in-web-sessions.md`.

## Problem & outcome

In a Claude Code **web session** the outbound path is a TLS-MITM egress proxy. CLI tools
(curl, Node/undici) traverse it fine, but **headless Chromium's HTTPS always fails with
`ERR_CONNECTION_RESET`** — direct _and_ via `HTTPS_PROXY`. Root cause (confirmed via
chrome net-log, runbook §"Why"): the proxy's TLS interceptor **rejects Chromium's
BoringSSL ClientHello** (fingerprint/ALPN) while accepting curl's/Node's OpenSSL
ClientHello. It is **NOT** a CA-trust problem — `--ignore-certificate-errors` and NSS
CA import do not help (a trust failure would be `ERR_CERT_*`, not a reset).

The consequence: every browser-driven QA tier (`/design-qa`, `/uat`, `/manual-uat`) and
both browser MCP servers (`playwright`, `chrome-devtools`) are dead against any real
external site in a web session. The operator has had to hand-troubleshoot this every
time. The existing `tools/design-qa-bridge/` works around it for **one** deployed URL by
curl-forwarding through a loopback HTTPS server — it cannot drive an arbitrary live site.

**Outcome:** an idempotent `make browser-up` that stands up a local `mitmdump` between
Chromium and the egress proxy — Chromium talks plain loopback (no fingerprint
rejection); mitmproxy re-makes the upstream TLS with its OpenSSL client, which the egress
proxy accepts. Once up, the wired MCP servers and the committed Playwright specs route
through `127.0.0.1:8080` **automatically**, so `/design-qa`, `/uat`, `/manual-uat`, and
ad-hoc MCP browsing drive **any** live site. Fail-open everywhere: off-platform (no
`$HTTPS_PROXY`) the bridge is a no-op and every browser path behaves exactly as today.

```
chromium --proxy-server=http://127.0.0.1:8080--> mitmdump --upstream--> egress proxy ($HTTPS_PROXY) --> origin
         (ignoreHTTPSErrors / NSS-trusts mitm CA)           (verifies egress CA via OpenSSL = accepted)
```

## Market scan

The fix is not a library choice — it is an environment workaround. The one build-vs-buy
axis is the local forward-proxy: **mitmproxy** (`mitmdump`, BSD, PyPI, on the proxy
no-proxy allowlist) is the runbook-proven tool and the de-facto standard for
scriptable TLS MITM; alternatives (a hand-rolled Node CONNECT relay, `Squid`) either
can't re-originate the TLS handshake with an OpenSSL client (the whole point) or are far
heavier. No new npm runtime dep is added; mitmproxy lives in a throwaway venv, not
`package.json`. Ledger: not a `lib/` capability, so no build-vs-buy ledger entry is
required by the ADR-032 hook — the reuse decision (generalize `tools/design-qa-bridge/`'s
loopback insight from one-URL curl-forwarding to any-site mitm-chaining) is recorded here.

## User stories

- **US-1 (operator, primary):** As the operator running `/design-qa` or `/uat` in a web
  session, I run one command (`make browser-up`) and thereafter the browser reaches any
  live site, so QA tiers actually run instead of failing with `ERR_CONNECTION_RESET`.
- **US-2 (operator, MCP):** As the operator using the `playwright` / `chrome-devtools`
  MCP servers to look at a live page, the browser routes through the bridge
  automatically when it's up — I don't hand-edit `.mcp.json` per session.
- **US-3 (fork off-platform):** As a developer on a normal machine (no egress proxy),
  `make browser-up` is a clean no-op and every browser path behaves as it does today —
  the change is purely additive.
- **US-4 (bonus, DB):** As the operator needing to read the Neon DB from a web session,
  I have a documented `@neondatabase/serverless` recipe (SQL over HTTPS/443) because raw
  TCP :5432 is firewalled — deferred to a documented recipe, not wired this increment.

## Happy path

1. `make browser-up` → script checks `$HTTPS_PROXY`; if set, ensures a `~/mmvenv`
   mitmproxy (idempotent — skip install if `mitmdump` already present), starts
   `mitmdump` on `127.0.0.1:8080` in `--mode upstream:$HTTPS_PROXY` with
   `ssl_verify_upstream_trusted_ca=/root/.ccr/ca-bundle.crt` and
   `connection_strategy=lazy`, trusts the mitmproxy CA (+ egress CA) in `~/.pki/nssdb`
   via `certutil`, writes an `up` sentinel + PID file, and curl-health-checks a 200
   through the chain. Prints the two env exports to eval.
2. The operator (or a skill) `eval`s the printed exports: `PW_PROXY_SERVER=http://127.0.0.1:8080`
   and `PW_EXECUTABLE_PATH=<glob-resolved chromium>`. `playwright.config.ts` already
   consumes both (issue #52) → committed specs route through the bridge with
   `ignoreHTTPSErrors`.
3. The `.mcp.json` `sh -c` wrappers read the sentinel and inject `--proxy-server
http://127.0.0.1:8080 --ignore-https-errors` only when it exists → MCP browsing
   routes through the bridge with zero per-session edits.
4. `make browser-status` reports up/healthy; `make browser-down` stops mitmdump and
   clears the sentinel.

## Worst / edge paths

- **No `$HTTPS_PROXY` (off-platform):** script prints "no egress proxy — browser reaches
  the internet directly; bridge not needed" and exits 0. Sentinel absent → MCP wrappers
  add no proxy args → unchanged. (US-3.)
- **mitmproxy install fails** (PyPI blocked / wheel build fails): script reports the
  specific failure and exits non-zero; sentinel not written → nothing silently half-wired.
  Uses `--prefer-binary` to dodge the `pyperclip` sdist build failure (runbook §Steps).
- **Port 8080 already in use / stale mitmdump:** `up` detects a live healthy bridge and
  no-ops (idempotent); detects a dead PID and restarts.
- **Health check fails after start** (mitmdump up but chain returns non-200): script
  tails the mitmdump log, reports it, exits non-zero, leaves no `up` sentinel.
- **certutil / libnss3-tools missing:** script `apt-get install -y libnss3-tools`
  (idempotent); if apt is unavailable it warns and continues (Playwright specs use
  `ignoreHTTPSErrors` so NSS trust is belt-and-suspenders for them; MCP servers get
  `--ignore-https-errors`).
- **Fail-open honesty:** the bridge NEVER silently swallows a real failure of a QA run —
  it only makes the _transport_ work. A skill that can't reach its target still reports
  that honestly.

## Architecture sketch

- **`scripts/browser-bridge.mjs`** (new) — subcommands `up` (default) | `status` |
  `down` | `env`. Pure Node (`node:child_process`, `node:fs`), no new dep. Idempotent,
  fail-open. Sentinel: `~/.browser-bridge/up` (contains the proxy URL); PID file
  `~/.browser-bridge/mitmdump.pid`; log `~/.browser-bridge/mitmdump.log`. `env` prints
  the `PW_PROXY_SERVER` / `PW_EXECUTABLE_PATH` exports for `eval "$(node scripts/browser-bridge.mjs env)"`.
- **`Makefile`** (edit) — `browser-up` / `browser-down` / `browser-status` targets
  wrapping the script (mirrors the existing `db-up`/`docker-up` target style).
- **`.mcp.json`** (edit) — wrap the `playwright` and `chrome-devtools` `sh -c` commands
  so a `[ -f ~/.browser-bridge/up ]` test conditionally appends the proxy +
  ignore-https-errors flags. Absent sentinel → byte-for-byte the current launch.
- **`playwright.config.ts`** — **unchanged**; it already reads `PW_PROXY_SERVER` +
  `PW_EXECUTABLE_PATH` and applies `ignoreHTTPSErrors` when proxying (issue #52). The
  bridge simply supplies `127.0.0.1:8080` instead of the raw (browser-hostile) egress proxy.
- **Skills** (`design-qa`, `uat`, `manual-uat`) — prose only: add a "web-session
  browser transport" prerequisite pointing at `make browser-up` + the runbook, and note
  that MCP/spec routing is automatic once it's up.
- **Bonus (deferred):** `@neondatabase/serverless` recipe stays documented in the
  runbook §Bonus + a `/scale-up` note; NOT installed this increment (it's an Ask-before
  > 50KB runtime dep and no current code path needs DB-from-browser-session).

## Tier

`personal` (template default) — infra/harness plumbing, no product surface, no security
floor change: no new route, no auth touch, no schema, no secret handling (the bridge
reads the already-present `$HTTPS_PROXY` / `/root/.ccr/ca-bundle.crt`, logs neither).

## Open questions (resolved)

1. **SessionStart auto-start?** — **INCLUDED** (operator, AskUserQuestion 2026-07-12).
   Resolved without the "adds 20–40s to every session" cost by a dedicated `auto`
   subcommand that **never installs** — it starts the bridge only when mitmproxy is
   already present and is a silent no-op otherwise (off-platform, or before the operator
   has run `make browser-up` once). `session-start.sh` calls it fail-open (`|| true`), so
   SessionStart stays fast and can't break.
2. **NSS trust vs `ignoreHTTPSErrors`?** — **Both, belt-and-suspenders.** MCP servers get
   `--ignore-https-errors` / `--acceptInsecureCerts`; committed specs already set
   `ignoreHTTPSErrors` when proxying; the script also imports the mitm CA into
   `~/.pki/nssdb` (best-effort — `libnss3-tools` may be unfetchable behind a stale apt
   index, in which case the ignore-cert flags cover it). Cheap, matches the runbook.
3. **Neon serverless — wire or document?** — **INCLUDED as a devDep recipe** (operator,
   AskUserQuestion 2026-07-12). `@neondatabase/serverless` is a **devDependency** (a
   session diagnostic tool, never in the app request path — the app still uses Prisma);
   `scripts/neon-sql.mjs` + `make db-sql SQL="…"` run SQL over HTTPS/443, dodging the
   firewalled raw TCP :5432. Also pointed at from `/scale-up` and the runbook §Bonus.

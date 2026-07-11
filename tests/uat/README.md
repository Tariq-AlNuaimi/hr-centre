# UAT — browser-driven user acceptance testing

Playwright (Chromium) walkthroughs of the app's key flows. The screenshots they
produce double as the artifact you share with stakeholders. See ADR-008 and the
`/uat` skill.

## One-time per machine

```sh
npm run uat:install   # downloads the Chromium binary
```

### Running in a Claude Code web session (issue #52)

Web-session environments ship a pre-installed Chromium under `/opt/pw-browsers`,
but its revision can lag the one the installed Playwright version expects (e.g.
PW 1.61 wants rev 1228; the env ships 1194), so the default launch fails with
`Executable doesn't exist`. `playwright.config.ts` resolves the binary in this
order, so you usually don't need to do anything:

1. **`PW_EXECUTABLE_PATH`** — explicit override, always wins:
   ```sh
   PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
   UAT_BASE_URL="https://<your-app>.vercel.app" npm run uat
   ```
2. **Auto-detect** — if unset, the config scans `$PLAYWRIGHT_BROWSERS_PATH`
   (default `/opt/pw-browsers`) for a `chromium-*/chrome-linux/chrome` and uses
   the highest revision found. This directory doesn't exist on normal dev
   machines, so it's a no-op there.
3. **`PW_PROXY_SERVER`** — when the environment only allows outbound traffic
   through an HTTPS egress proxy (a web session's `$HTTPS_PROXY`), point the
   browser at it so it can reach a deployed target. While a proxy is set the
   config also accepts the proxy's TLS-MITM cert (scoped to that case only):
   ```sh
   PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
   PW_PROXY_SERVER="$HTTPS_PROXY" \
   UAT_BASE_URL="https://<your-app>.vercel.app" npm run uat
   ```

> Outbound egress to drive a _deployed_ browser target may still be restricted
> by the session's network policy — and whether the proxy above is actually
> browser-traversable is an environment property, not something the config can
> guarantee. That's an environment limit, not a config one. Run UAT against a
> deployed `UAT_BASE_URL` from a machine with egress, or use the Playwright MCP
> browser for in-session walkthroughs.

## Run it

```sh
# Against a deployed URL (preferred — your Vercel preview / prod):
UAT_BASE_URL="https://<your-app>.vercel.app" \
UAT_EMAIL="you@example.com" UAT_PASSWORD="..." \
  npm run uat

# Against local dev (auto-starts `npm run dev`; needs a DB + seeded admin):
SEED_ADMIN_EMAIL="admin@example.com" SEED_ADMIN_PASSWORD="..." \
  npm run uat

npm run uat:report    # open the HTML report with screenshots
```

## Credentials

Come from env only — never hardcoded:
`UAT_EMAIL`/`UAT_PASSWORD` (preferred, a dedicated UAT account) or
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` (the seeded admin).

## Files

- `auth.setup.ts` — logs in once, saves the session.
- `smoke.uat.ts` — authenticated walkthrough of the shipped screens (add yours here).
- `guard.uat.ts` — unauthenticated visitors are bounced to login.

> UAT exercises a running app's flows; it is **not** a security pentest. Code-level
> scanning lives in `/audit` and `/ship`; live-app security scanning is the planned
> `/vapt` (OWASP ZAP) follow-up.

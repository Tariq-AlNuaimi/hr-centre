# UAT — browser-driven user acceptance testing

Playwright (Chromium) walkthroughs of the app's key flows. The screenshots they
produce double as the artifact you share with stakeholders. See ADR-008 and the
`/uat` skill.

## One-time per machine
```sh
npm run uat:install   # downloads the Chromium binary
```

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

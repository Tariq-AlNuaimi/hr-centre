# design-qa-bridge — run a real browser against the deployed app in a web session

**Problem this solves.** In a Claude Code web session, outbound HTTPS goes through
a TLS-MITM egress proxy. `curl` and Node `fetch` traverse it fine, but **Chromium
does not** — every navigation to an external HTTPS host dies with
`net::ERR_CONNECTION_RESET`. That is why `/design-qa` (and any browser-driven
`/uat` / `/manual-uat`) against a deployed Vercel URL "could not run" for many
sessions. Local `npm run dev` is not an alternative for authenticated screens
because the DB is Neon and Postgres :5432 egress is also blocked here.

**How the bridge works.** The browser CAN reach loopback (127.0.0.1 is in
`NO_PROXY`). `bridge.mjs` is a loopback HTTPS server the browser hits directly; it
forwards every request upstream to the deployed app **via `curl`** (which does
traverse the proxy). Serving HTTPS on loopback means the app's `Secure __Host-`
Auth.js cookies work, so login and authenticated screens render for real.

## Recipe

```bash
# 0. Deploy the branch to a real Vercel PROD url (seed auto-runs). Capture the
#    seeded admin password printed by the deploy.
npm run deploy -- --slug <slug> --display-name "…" --owner <owner> \
  --admin-email admin@example.com --ref <branch>
# (re-deploys of the SAME project: trigger a prod deployment via the Vercel API
#  for the existing project id — see scripts/deploy.mjs step 4 for the payload.)

# 1. Self-signed cert (once per container; short-lived is fine).
openssl req -x509 -newkey rsa:2048 -nodes -days 5 \
  -keyout /tmp/bridge-key.pem -out /tmp/bridge-cert.pem \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# 2. Start the bridge (background).
BRIDGE_UPSTREAM=https://<app>.vercel.app \
BRIDGE_CERT=/tmp/bridge-cert.pem BRIDGE_KEY=/tmp/bridge-key.pem \
NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
node tools/design-qa-bridge/bridge.mjs &

# 3. Drive Chromium at https://127.0.0.1:8443 and inject axe-core (below).
```

## axe driver (standalone Playwright — full control over cert/auth/axe)

Chromium at `/opt/pw-browsers/chromium-*/chrome-linux/chrome`. Launch with
`{ args: ["--no-sandbox"] }` and context `{ ignoreHTTPSErrors: true }`. Log in by
filling `input[name="email"]` / `input[name="password"]` and clicking
`button[type="submit"]`, then **gate on the `session-token` cookie appearing**
(the client redirect may not fire through the bridge — navigate directly instead).
Inject `node_modules/axe-core/axe.min.js` via `page.evaluate(axeSource)` then
`await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a",
"wcag2aa","wcag21a","wcag21aa"] } })` and filter `impact` `serious`/`critical`.

Dark mode: add a `theme-mode=dark` cookie to the context before navigating.
RTL: use the `/ar` locale (only meaningful when the fork ships `["en","ar"]`).

The committed regression spec `tests/uat/design-a11y.uat.ts` is the durable form
(run against a real URL where no bridge is needed — e.g. a CI runner with open
egress); the bridge is only for driving a browser from *inside* a web session.

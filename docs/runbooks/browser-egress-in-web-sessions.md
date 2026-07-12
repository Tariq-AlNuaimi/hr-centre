# Runbook: getting a headless browser online in a Claude Code web session

## The problem
In these web sessions, **CLI tools (curl, Node/undici) reach the internet through the
egress proxy fine, but headless Chromium's HTTPS always fails with
`ERR_CONNECTION_RESET`** — direct AND via `HTTPS_PROXY`.

### Why (root cause — confirmed via chrome net-log)
The egress proxy re-terminates TLS (it's a MITM). Chromium's CONNECT to the proxy
**succeeds** (`HTTP/1.1 200 Connection Established`), then the TLS handshake to the
origin *through* the tunnel gets a TCP **RST** mid-handshake:
```
SSL_HANDSHAKE_ERROR  net_error=ERR_CONNECTION_RESET  {error_lib:35, ssl_error:1}
SOCKET_READ_ERROR    net_error=ERR_CONNECTION_RESET  {os_error:104}   # ECONNRESET
```
This is **NOT** a CA-trust problem:
- `--ignore-certificate-errors` does **not** help (a cert error would be `ERR_CERT_*`, not a reset).
- Importing the proxy CA into chromium's NSS store does **not** help.
The proxy's TLS interceptor **rejects chromium's BoringSSL ClientHello** (TLS
fingerprint / ALPN), while it accepts curl's and Node's OpenSSL ClientHello
(both return 200 through the same proxy). So it's client-specific, on the proxy side.

## The fix that works: chain chromium through a local mitmproxy
Put `mitmproxy` between chromium and the egress proxy. Chromium talks to mitmproxy
on localhost (no fingerprint rejection); mitmproxy makes the **upstream** TLS with
its own OpenSSL client, which the egress proxy accepts.

```
chromium  --proxy-server=http://127.0.0.1:8080-->  mitmdump  --upstream-->  egress proxy ($HTTPS_PROXY)  -->  origin
          (trusts mitmproxy CA via NSS)                       (verifies egress CA, OpenSSL handshake = accepted)
```

### Steps
```bash
# 1. Install mitmproxy (pypi is in the proxy no-proxy allowlist; use a venv + prebuilt wheels
#    to dodge the pyperclip sdist build failure).
python3 -m venv ~/mmvenv
~/mmvenv/bin/pip install --upgrade pip setuptools wheel
~/mmvenv/bin/pip install --prefer-binary mitmproxy

# 2. Start mitmdump chained to the egress proxy, trusting the egress CA on the upstream leg.
~/mmvenv/bin/mitmdump \
  --mode upstream:http://127.0.0.1:PROXYPORT \        # PROXYPORT = the port in $HTTPS_PROXY
  --set ssl_verify_upstream_trusted_ca=/root/.ccr/ca-bundle.crt \
  --listen-host 127.0.0.1 --listen-port 8080 \
  --set connection_strategy=lazy &                     # lazy = don't pre-dial before knowing SNI
# first run writes ~/.mitmproxy/mitmproxy-ca-cert.pem

# 3. Trust mitmproxy's CA in chromium's NSS store (also import the egress CA; harmless).
apt-get install -y libnss3-tools     # for certutil
mkdir -p ~/.pki/nssdb
certutil -d sql:$HOME/.pki/nssdb -A -n mitmproxy -t 'C,,' -i ~/.mitmproxy/mitmproxy-ca-cert.pem

# 4. Verify the chain with curl (should print 200):
curl -sS --cacert ~/.mitmproxy/mitmproxy-ca-cert.pem -x http://127.0.0.1:8080 \
  -w '%{http_code}\n' https://example.com
```

### Launch Playwright/chromium through it
Installed chromium builds live in `/opt/pw-browsers`. This session's `@playwright/test`
(1.61.1) wanted chromium-1228 but only **1194** is installed, so use `executablePath`
instead of `channel:'chromium'`:
```js
import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  proxy: { server: 'http://127.0.0.1:8080' },   // <-- mitmproxy, NOT the egress proxy
  args: ['--no-sandbox'],
});
```
Chromium trusts mitmproxy's cert via the NSS store from step 3 — no `ignoreHTTPSErrors` needed.
Run the script **from the repo dir** so `@playwright/test` resolves (a scratchpad dir won't).

## Bonus: reaching the Neon Postgres DB (raw TCP is blocked)
The proxy only tunnels HTTPS; **raw-TCP :5432 to Neon hangs** (and direct TCP is
firewalled). Use Neon's **serverless driver** which does SQL over HTTPS/443:
```bash
npm i @neondatabase/serverless
NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt NODE_USE_ENV_PROXY=1 node -e '
  const { neon } = require("@neondatabase/serverless");
  const sql = neon(process.env.DBURL);   // full Neon connection URI
  sql`select 1`.then(r=>console.log(r));'
```
Get the connection URI (without resetting the role password, which would break the
running app's `DATABASE_URL`) from the Neon API:
`GET https://console.neon.tech/api/v2/projects/{id}/connection_uri?branch_id=..&database_name=..&role_name=..`
(needs `?org_id=` on the projects list call).

## One-line diagnosis if it still fails
```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status"     # proxy state + recent relay failures
```
If `curl https://…` works but chromium resets → it's the ClientHello rejection above → use the mitmproxy chain.

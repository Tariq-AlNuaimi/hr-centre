// Loopback HTTPS -> deployed-app bridge for browser-driven QA in a Claude Code
// web session (design-qa / uat / manual-uat).
//
// WHY: in this remote env, outbound HTTPS goes through a TLS-MITM egress proxy.
// `curl` and Node `fetch` traverse it fine, but **Chromium does not** — every
// navigation to an external HTTPS host fails with net::ERR_CONNECTION_RESET
// (the browser cannot complete the proxied CONNECT + MITM handshake). That is
// why the program's `/design-qa` axe pass went un-run for many sessions.
//
// FIX: the browser CAN reach loopback (127.0.0.1 is in NO_PROXY). So run this
// tiny HTTPS server on loopback, point Playwright/axe at it, and it forwards
// every request UPSTREAM to the deployed app **via curl** (which traverses the
// proxy). Serving HTTPS on loopback means the app's `Secure` __Host- auth
// cookies work, so login flows and authenticated screens render for real.
//
// USAGE:
//   1. Deploy the branch to a real Vercel prod URL (npm run deploy -- --ref <branch>).
//   2. Generate a self-signed cert (once):
//        openssl req -x509 -newkey rsa:2048 -nodes -days 5 \
//          -keyout bridge-key.pem -out bridge-cert.pem \
//          -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
//   3. BRIDGE_UPSTREAM=https://<app>.vercel.app \
//      BRIDGE_CERT=bridge-cert.pem BRIDGE_KEY=bridge-key.pem \
//      node tools/design-qa-bridge/bridge.mjs
//   4. Drive Chromium (Playwright) at https://127.0.0.1:8443 with
//      { ignoreHTTPSErrors: true, args: ["--no-sandbox"] } and inject axe-core.
//      Rewrite the login origin/referer is handled here so Auth.js CSRF passes.
//      NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt for the curl subprocess trust.
//
// See README.md in this folder for the axe-run driver snippet.
import https from "node:https";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const UPSTREAM = process.env.BRIDGE_UPSTREAM;
if (!UPSTREAM) { console.error("Set BRIDGE_UPSTREAM=https://<app>.vercel.app"); process.exit(1); }
const UP_ORIGIN = new URL(UPSTREAM).origin;
const CA = process.env.BRIDGE_CA || "/root/.ccr/ca-bundle.crt";
const PROXY = process.env.HTTPS_PROXY;
const PORT = Number(process.env.BRIDGE_PORT || 8443);
const CERT = process.env.BRIDGE_CERT || "bridge-cert.pem";
const KEY = process.env.BRIDGE_KEY || "bridge-key.pem";

const HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host", "accept-encoding",
  "content-length",
]);

function curlFetch(method, path, reqHeaders, bodyBuf) {
  return new Promise((resolve) => {
    const args = ["-sS", "-i", "--http1.1", "--compressed", "--proxy", PROXY, "--cacert", CA, "-X", method, "--max-time", "45"];
    for (const [k, v] of Object.entries(reqHeaders)) {
      const kl = k.toLowerCase();
      if (HOP.has(kl)) continue;
      // Force upstream origin/referer so Auth.js CSRF/origin checks see a
      // consistent trusted host, not the loopback bridge.
      if (kl === "origin") { args.push("-H", `Origin: ${UP_ORIGIN}`); continue; }
      if (kl === "referer") { args.push("-H", `Referer: ${UP_ORIGIN}${new URL(v, UP_ORIGIN).pathname}`); continue; }
      args.push("-H", `${k}: ${v}`);
    }
    if (bodyBuf && bodyBuf.length) args.push("--data-binary", "@-");
    args.push(UPSTREAM + path);
    const cp = spawn("curl", args);
    const chunks = [];
    cp.stdout.on("data", (d) => chunks.push(d));
    cp.on("close", () => resolve(Buffer.concat(chunks)));
    if (bodyBuf && bodyBuf.length) cp.stdin.write(bodyBuf);
    cp.stdin.end();
  });
}

function parseResponse(buf) {
  // Skip the proxy CONNECT block(s) ("HTTP/1.1 200 Connection established").
  let cursor = 0;
  let sep = buf.indexOf("\r\n\r\n", cursor);
  while (sep !== -1) {
    const firstLine = buf.subarray(cursor, buf.indexOf("\r\n", cursor)).toString("latin1");
    if (/connection established/i.test(firstLine) || /^HTTP\/\d\.\d\s+1\d\d/.test(firstLine)) {
      cursor = sep + 4; sep = buf.indexOf("\r\n\r\n", cursor); continue;
    }
    break;
  }
  const headBuf = sep === -1 ? buf.subarray(cursor) : buf.subarray(cursor, sep);
  const body = sep === -1 ? Buffer.alloc(0) : buf.subarray(sep + 4);
  const lines = headBuf.toString("latin1").split("\r\n");
  const statusLine = lines.shift() || "HTTP/1.1 502 Bad Gateway";
  const status = parseInt(statusLine.split(" ")[1], 10) || 502;
  const headers = [];
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    const kl = k.toLowerCase();
    if (HOP.has(kl) || kl === "content-encoding") continue;
    if (kl === "location") v = v.replace(UP_ORIGIN, "");
    headers.push([k, v]);
  }
  return { status, headers, body };
}

https.createServer({ key: readFileSync(KEY), cert: readFileSync(CERT) }, async (req, res) => {
  const bodyChunks = [];
  req.on("data", (c) => bodyChunks.push(c));
  req.on("end", async () => {
    try {
      const raw = await curlFetch(req.method, req.url, req.headers, Buffer.concat(bodyChunks));
      const { status, headers, body } = parseResponse(raw);
      res.writeHead(status, headers);
      res.end(body);
    } catch (e) {
      res.writeHead(502);
      res.end("bridge error: " + e.message);
    }
  });
}).listen(PORT, "127.0.0.1", () => console.log(`bridge up on https://127.0.0.1:${PORT} -> ${UPSTREAM}`));

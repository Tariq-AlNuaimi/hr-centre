// Vibe Inspector — site capture via Browserbase over raw CDP (ADR-016).
//
// We talk to the remote Chromium directly over the Chrome DevTools Protocol on a
// WebSocket (the `ws` client) instead of bundling playwright-core. One session
// collects everything the analysis layer needs for a comprehensive audit:
//   • desktop + mobile screenshots (design / responsive)
//   • visible text, links, control counts (functionality / BRD coverage)
//   • console + runtime errors (functionality)
//   • performance metrics — load timing, request count, transfer size
//   • accessibility violations via an injected axe-core scan
//   • main-document status + security headers
//   • broken internal links (HEAD-checked from the function)
//
// Config comes from Settings → Browser engine (DB) with an env fallback — see
// lib/testing/browser-config.ts. When unset, captureSite throws a clear error so the
// run is recorded as FAILED (never a false green).

import WebSocket from "ws";
import axe from "axe-core";
import { resolveBrowserConfig } from "./browser-config";
import { isSafePublicUrl } from "@/lib/validations/url-safety";
import { redactSecret } from "@/lib/secret-box";

export interface AxeViolation {
  id: string;
  impact: string; // critical | serious | moderate | minor
  help: string;
  nodes: number;
}

export interface PerfMetrics {
  loadMs: number;
  domContentLoadedMs: number;
  requestCount: number;
  transferKb: number;
}

export interface BrokenLink {
  url: string;
  status: number; // HTTP status, or 0 for unreachable/timeout
}

export interface CaptureAuth {
  mode: "FORM" | "COOKIE";
  loginUrl?: string; // FORM
  username?: string; // FORM
  password?: string; // FORM
  cookie?: string; // COOKIE: "name=value; name2=value2"
}

export interface CaptureResult {
  finalUrl: string;
  title: string;
  status: number | null;
  screenshotBase64: string; // desktop
  mobileScreenshotBase64: string; // mobile (may be "" if it failed)
  screenshotMediaType: "image/png";
  visibleText: string;
  links: string[];
  buttonsCount: number;
  formsCount: number;
  inputsCount: number;
  consoleErrors: string[];
  perf: PerfMetrics;
  axeViolations: AxeViolation[];
  brokenLinks: BrokenLink[];
  securityHeaders: Record<string, string>;
  isHttps: boolean;
  // Multi-page crawl (ADR-016): per-page summaries (entry first), a couple of extra
  // desktop screenshots for the design pass, and how many pages were audited. The
  // top-level fields above are the ENTRY page; the array/aggregate fields
  // (axeViolations, brokenLinks, consoleErrors, links) are unioned across all pages.
  pages: PageSummary[];
  extraScreenshots: string[];
  pagesAudited: number;
}

// Lightweight per-page record carried into the analysis + report.
export interface PageSummary {
  url: string;
  title: string;
  status: number | null;
  perf: PerfMetrics;
  axeCount: number;
  consoleErrorCount: number;
  brokenLinkCount: number;
  buttonsCount: number;
  formsCount: number;
  inputsCount: number;
  textSnippet: string;
}

// Full per-page capture (internal; screenshots are heavy so only a few are kept).
interface PageAudit {
  url: string;
  title: string;
  status: number | null;
  screenshotBase64: string;
  mobileScreenshotBase64: string;
  visibleText: string;
  links: string[];
  buttonsCount: number;
  formsCount: number;
  inputsCount: number;
  consoleErrors: string[];
  perf: PerfMetrics;
  axeViolations: AxeViolation[];
  brokenLinks: BrokenLink[];
  securityHeaders: Record<string, string>;
}

const SECURITY_HEADER_NAMES = [
  "content-security-policy",
  "strict-transport-security",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "x-xss-protection",
];

export const CONNECT_BASE = "wss://connect.browserbase.com";

interface BrowserbaseSession {
  id: string;
}

export async function createSession(apiKey: string, projectId: string): Promise<BrowserbaseSession> {
  const res = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BB-API-Key": apiKey },
    body: JSON.stringify({ projectId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Browserbase session create failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as BrowserbaseSession;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Minimal CDP client over a WebSocket: id-correlated commands + method-keyed events.
type CdpParams = Record<string, unknown>;
type EventHandler = (params: CdpParams, sessionId?: string) => void;

export class Cdp {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: CdpParams) => void; reject: (e: Error) => void }>();
  private handlers = new Map<string, EventHandler[]>();

  constructor(private ws: WebSocket) {
    ws.on("message", (data: WebSocket.RawData) => this.onMessage(data));
  }

  send(method: string, params: CdpParams = {}, sessionId?: string): Promise<CdpParams> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  on(method: string, handler: EventHandler): void {
    const arr = this.handlers.get(method) ?? [];
    arr.push(handler);
    this.handlers.set(method, arr);
  }

  waitFor(method: string, predicate: (p: CdpParams, sid?: string) => boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      this.on(method, (params, sid) => {
        if (predicate(params, sid)) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }

  private onMessage(data: WebSocket.RawData): void {
    let msg: {
      id?: number;
      method?: string;
      params?: CdpParams;
      sessionId?: string;
      result?: CdpParams;
      error?: { message?: string };
    };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (typeof msg.id === "number" && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message ?? "CDP error"));
      else resolve(msg.result ?? {});
    } else if (msg.method) {
      for (const h of this.handlers.get(msg.method) ?? []) h(msg.params ?? {}, msg.sessionId);
    }
  }
}

const PAGE_SCRIPT = `(() => {
  const text = (document.body && document.body.innerText || "").replace(/\\s+/g, " ").trim();
  const hrefs = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => a.href).filter((h) => h && h.indexOf("javascript:") !== 0);
  return {
    finalUrl: location.href,
    title: document.title || "",
    text: text.slice(0, 12000),
    links: Array.from(new Set(hrefs)).slice(0, 100),
    buttonsCount: document.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']").length,
    formsCount: document.querySelectorAll("form").length,
    inputsCount: document.querySelectorAll("input, textarea, select").length,
  };
})()`;

const PERF_SCRIPT = `(() => {
  const nav = (performance.getEntriesByType("navigation")[0] || {});
  const res = performance.getEntriesByType("resource") || [];
  const transfer = res.reduce((s, r) => s + (r.transferSize || 0), 0) + (nav.transferSize || 0);
  return {
    loadMs: Math.max(0, Math.round(nav.loadEventEnd || 0)),
    domContentLoadedMs: Math.max(0, Math.round(nav.domContentLoadedEventEnd || 0)),
    requestCount: res.length + 1,
    transferKb: Math.round(transfer / 1024),
  };
})()`;

// Runs axe-core (already injected) and returns a compact violations list.
const AXE_RUN_SCRIPT = `(async () => {
  try {
    const r = await axe.run(document, { resultTypes: ["violations"] });
    return r.violations.slice(0, 60).map((v) => ({ id: v.id, impact: v.impact || "minor", help: v.help, nodes: v.nodes.length }));
  } catch (e) { return []; }
})()`;

const EMPTY_PERF: PerfMetrics = { loadMs: 0, domContentLoadedMs: 0, requestCount: 0, transferKb: 0 };

// Fills a login form heuristically (username/email + password) and submits it.
// Returns whether the fields were found so the caller can fail loudly if not.
function loginFillScript(username: string, password: string): string {
  return `(() => {
    const u = document.querySelector("input[type=email]")
      || document.querySelector("input[name*='user' i]")
      || document.querySelector("input[id*='user' i]")
      || document.querySelector("input[id*='email' i]")
      || document.querySelector("input[name*='email' i]")
      || document.querySelector("input[type=text]");
    const p = document.querySelector("input[type=password]");
    const set = (el, v) => { if (!el) return; el.focus(); el.value = v;
      el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
    set(u, ${JSON.stringify(username)}); set(p, ${JSON.stringify(password)});
    const btn = document.querySelector("button[type=submit]")
      || document.querySelector("input[type=submit]")
      || (p && p.form && p.form.querySelector("button"))
      || document.querySelector("button");
    let submitted = false;
    if (btn) { btn.click(); submitted = true; }
    else if (p && p.form) { p.form.submit(); submitted = true; }
    return { foundUser: !!u, foundPass: !!p, submitted };
  })()`;
}

// Parses a "name=value; name2=value2" cookie string into CDP cookie params for the
// target URL. Bounded; ignores malformed pairs.
function parseCookies(cookie: string, url: string): { name: string; value: string; url: string }[] {
  return cookie
    .split(/;\s*/)
    .map((pair) => {
      const idx = pair.indexOf("=");
      if (idx <= 0) return null;
      return { name: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim(), url };
    })
    .filter((c): c is { name: string; value: string; url: string } => c !== null && c.name.length > 0)
    .slice(0, 30);
}

interface PageData {
  finalUrl: string;
  title: string;
  text: string;
  links: string[];
  buttonsCount: number;
  formsCount: number;
  inputsCount: number;
}
const EMPTY_PAGE: PageData = {
  finalUrl: "",
  title: "",
  text: "",
  links: [],
  buttonsCount: 0,
  formsCount: 0,
  inputsCount: 0,
};

// HEAD-check a bounded sample of links on the ORIGINAL target host; flag 4xx/5xx/
// unreachable. SSRF-guarded: anchored to the operator-validated target host (not the
// post-redirect finalUrl), each link re-validated as a public URL, and redirects are
// NOT followed (a 3xx Location can't drag us onto an internal/metadata host).
async function checkBrokenLinks(links: string[], targetHost: string): Promise<BrokenLink[]> {
  if (!targetHost) return [];
  const sample = links
    .filter((l) => {
      try {
        return new URL(l).hostname === targetHost && isSafePublicUrl(l);
      } catch {
        return false;
      }
    })
    .slice(0, 12);

  const broken: BrokenLink[] = [];
  await Promise.all(
    sample.map(async (l) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        let r = await fetch(l, { method: "HEAD", redirect: "manual", signal: controller.signal });
        // Some servers reject HEAD (405) — retry with GET before judging.
        if (r.status === 405) r = await fetch(l, { method: "GET", redirect: "manual", signal: controller.signal });
        // 3xx is a redirect we deliberately don't follow — not "broken".
        if (r.status >= 400) broken.push({ url: l, status: r.status });
      } catch {
        broken.push({ url: l, status: 0 });
      } finally {
        clearTimeout(timer);
      }
    })
  );
  return broken;
}

/**
 * Capture a single page comprehensively. Timeouts are bounded so a slow target
 * can't blow the function's maxDuration.
 */
export async function captureSite(
  targetUrl: string,
  auth?: CaptureAuth,
  maxPages = 1
): Promise<CaptureResult> {
  const { apiKey, projectId } = await resolveBrowserConfig();
  const url = /^https?:\/\//i.test(targetUrl) ? targetUrl : `https://${targetUrl}`;

  const session = await createSession(apiKey, projectId);
  const connectUrl = `${CONNECT_BASE}?apiKey=${encodeURIComponent(apiKey)}&sessionId=${encodeURIComponent(session.id)}`;

  const ws = new WebSocket(connectUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to the browser")), 15_000);
      ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once("error", (e) => {
        clearTimeout(timer);
        // Scrub the API key — the connect URL (which some ws errors echo) carries it.
        reject(new Error(redactSecret(e instanceof Error ? e.message : String(e), apiKey)));
      });
    });

    const cdp = new Cdp(ws);
    const { targetId } = (await cdp.send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
    const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId, flatten: true })) as {
      sessionId: string;
    };

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);

    // Console + runtime errors.
    const consoleErrors: string[] = [];
    const CONSOLE_CAP = 100; // bound memory against a hostile/noisy page
    cdp.on("Runtime.consoleAPICalled", (p, sid) => {
      if (sid !== sessionId || p.type !== "error" || consoleErrors.length >= CONSOLE_CAP) return;
      const args = (p.args as { value?: unknown; description?: string }[] | undefined) ?? [];
      const text = args.map((a) => String(a.value ?? a.description ?? "")).join(" ");
      if (text) consoleErrors.push(text.slice(0, 300));
    });
    cdp.on("Runtime.exceptionThrown", (p, sid) => {
      if (sid !== sessionId || consoleErrors.length >= CONSOLE_CAP) return;
      const d = p.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
      const text = d?.exception?.description ?? d?.text ?? "";
      if (text) consoleErrors.push(String(text).slice(0, 300));
    });

    await cdp
      .send(
        "Emulation.setDeviceMetricsOverride",
        { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false },
        sessionId
      )
      .catch(() => {});

    // Collect Document responses only while CAPTURING the target (after any login
    // navigation). We pick the one matching the final URL afterwards, so a slow
    // login/redirect response can't be mistaken for the target's.
    let capturing = false;
    const documents: { url: string; status: number | null; headers: Record<string, string> }[] = [];
    cdp.on("Network.responseReceived", (params, sid) => {
      if (!capturing || sid !== sessionId || params.type !== "Document") return;
      const r = params.response as { url?: string; status?: number; headers?: Record<string, string> } | undefined;
      if (r) documents.push({ url: r.url ?? "", status: r.status ?? null, headers: r.headers ?? {} });
    });

    // -- Authentication (ADR-016): fail LOUDLY if auth was requested but can't be
    // applied (missing login URL/password, or an empty/undecryptable cookie) — never
    // silently capture anonymously and report a passing authenticated result.
    if (auth?.mode === "FORM" && (!auth.loginUrl?.trim() || !auth.password)) {
      throw new Error(
        "Authentication is set to form login, but the login URL or password is missing/undecryptable. " +
          "Re-enter the credentials (secrets aren't stored in plaintext and may need re-supplying)."
      );
    }
    if (auth?.mode === "COOKIE" && !auth.cookie?.trim()) {
      throw new Error(
        "Authentication is set to cookie, but no session cookie was provided (or it could not be decrypted). Re-enter it."
      );
    }

    if (auth?.mode === "COOKIE" && auth.cookie?.trim()) {
      const cookies = parseCookies(auth.cookie, url);
      if (cookies.length > 0) await cdp.send("Network.setCookies", { cookies }, sessionId).catch(() => {});
    }
    if (auth?.mode === "FORM" && auth.loginUrl?.trim()) {
      const loginLoaded = cdp.waitFor("Page.loadEventFired", (_p, sid) => sid === sessionId, 20_000);
      await cdp.send("Page.navigate", { url: auth.loginUrl }, sessionId).catch(() => {});
      await loginLoaded.catch(() => {});
      await sleep(800);
      const fillRes = (await cdp
        .send(
          "Runtime.evaluate",
          { expression: loginFillScript(auth.username ?? "", auth.password ?? ""), returnByValue: true },
          sessionId
        )
        .catch(() => ({ result: { value: { foundUser: false, foundPass: false, submitted: false } } }))) as {
        result?: { value?: { foundUser: boolean; foundPass: boolean; submitted: boolean } };
      };
      const fill = fillRes.result?.value;
      if (!fill?.foundPass || !fill?.submitted) {
        throw new Error(
          "Login failed: could not find/submit a username+password form on the login page. " +
            "Check the login URL, or use Cookie mode for SSO/MFA."
        );
      }
      // Wait for the post-submit navigation (or settle if it's an XHR login).
      await cdp.waitFor("Page.loadEventFired", (_p, sid) => sid === sessionId, 15_000).catch(() => {});
      await sleep(1200);
    }

    capturing = true;
    // Anchor crawling + the broken-link check to the ORIGINAL validated target host,
    // never a (potentially redirected) finalUrl — see checkBrokenLinks SSRF note.
    let entryHost = "";
    try {
      entryHost = new URL(url).hostname;
    } catch {
      /* leave empty -> no link checks / no crawl */
    }

    // Capture ONE page end-to-end: navigate, desktop (+ optional mobile) screenshot,
    // DOM signals, perf, axe, and resolve its main-document status/headers + broken links.
    async function capturePage(pageUrl: string, withMobile: boolean): Promise<PageAudit> {
      await cdp
        .send(
          "Emulation.setDeviceMetricsOverride",
          { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false },
          sessionId
        )
        .catch(() => {});
      consoleErrors.length = 0; // per-page console errors
      documents.length = 0; // per-page documents — don't inherit a prior page's status/headers
      const loaded = cdp.waitFor("Page.loadEventFired", (_p, sid) => sid === sessionId, 25_000);
      try {
        await cdp.send("Page.navigate", { url: pageUrl }, sessionId);
      } catch (navErr) {
        throw new Error(`Could not load ${pageUrl}: ${navErr instanceof Error ? navErr.message : String(navErr)}`);
      }
      await loaded.catch(() => {});
      await sleep(900);

      const { data: screenshotBase64 } = (await cdp.send(
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: false },
        sessionId
      )) as { data: string };

      const domRes = (await cdp.send(
        "Runtime.evaluate",
        { expression: PAGE_SCRIPT, returnByValue: true },
        sessionId
      )) as { result?: { value?: PageData } };
      const dom: PageData = domRes.result?.value ?? EMPTY_PAGE;

      let perf: PerfMetrics = EMPTY_PERF;
      try {
        const perfRes = (await cdp.send(
          "Runtime.evaluate",
          { expression: PERF_SCRIPT, returnByValue: true },
          sessionId
        )) as { result?: { value?: PerfMetrics } };
        if (perfRes.result?.value) perf = perfRes.result.value;
      } catch {
        /* leave EMPTY_PERF */
      }

      let axeViolations: AxeViolation[] = [];
      try {
        await cdp.send("Runtime.evaluate", { expression: axe.source }, sessionId);
        const axeRes = (await cdp.send(
          "Runtime.evaluate",
          { expression: AXE_RUN_SCRIPT, awaitPromise: true, returnByValue: true },
          sessionId
        )) as { result?: { value?: AxeViolation[] } };
        if (Array.isArray(axeRes.result?.value)) axeViolations = axeRes.result!.value!;
      } catch {
        /* axe unavailable */
      }

      let mobileScreenshotBase64 = "";
      if (withMobile) {
        try {
          await cdp.send(
            "Emulation.setDeviceMetricsOverride",
            { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
            sessionId
          );
          await sleep(500);
          const shot = (await cdp.send(
            "Page.captureScreenshot",
            { format: "png", captureBeyondViewport: false },
            sessionId
          )) as { data: string };
          mobileScreenshotBase64 = shot.data;
        } catch {
          /* mobile optional */
        }
      }

      const finalUrl = dom.finalUrl || pageUrl;
      const docs = documents.filter((d) => d.url === finalUrl);
      const mainDoc = docs[docs.length - 1] ?? documents[documents.length - 1];
      const securityHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(mainDoc?.headers ?? {})) {
        const key = k.toLowerCase();
        if (SECURITY_HEADER_NAMES.includes(key)) securityHeaders[key] = v;
      }
      const brokenLinks = await checkBrokenLinks(dom.links, entryHost);
      return {
        url: finalUrl,
        title: dom.title,
        status: mainDoc?.status ?? null,
        screenshotBase64,
        mobileScreenshotBase64,
        visibleText: dom.text,
        links: dom.links,
        buttonsCount: dom.buttonsCount,
        formsCount: dom.formsCount,
        inputsCount: dom.inputsCount,
        consoleErrors: [...consoleErrors],
        perf,
        axeViolations,
        brokenLinks,
        securityHeaders,
      };
    }

    // Entry page (with the mobile shot), then crawl same-origin links up to maxPages.
    const entry = await capturePage(url, true);

    const visited = new Set<string>([entry.url.split("#")[0]]);
    const queue: string[] = [];
    for (const href of entry.links) {
      const clean = href.split("#")[0];
      let host = "";
      try {
        host = new URL(clean).hostname;
      } catch {
        continue;
      }
      if (host !== entryHost) continue; // same-origin only
      if (!isSafePublicUrl(clean)) continue; // SSRF parity with the broken-link checker
      if (visited.has(clean) || queue.includes(clean)) continue;
      if (/\.(pdf|zip|jpe?g|png|gif|svg|webp|mp4|webm|css|js|ico|woff2?)(\?|$)/i.test(clean)) continue;
      queue.push(clean);
      if (queue.length >= Math.max(0, maxPages - 1)) break;
    }

    const audits: PageAudit[] = [entry];
    for (const link of queue) {
      try {
        const a = await capturePage(link, false);
        audits.push(a);
        visited.add(a.url.split("#")[0]);
      } catch {
        /* a page that won't load shouldn't sink the run — skip it */
      }
    }

    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});

    // Aggregate issue signals across every audited page (dedup, capped).
    const axeMap = new Map<string, AxeViolation>();
    for (const v of audits.flatMap((a) => a.axeViolations)) {
      const e = axeMap.get(v.id);
      if (!e || v.nodes > e.nodes) axeMap.set(v.id, v);
    }
    const brokenMap = new Map<string, BrokenLink>();
    for (const b of audits.flatMap((a) => a.brokenLinks)) if (!brokenMap.has(b.url)) brokenMap.set(b.url, b);

    const pages: PageSummary[] = audits.map((a) => ({
      url: a.url,
      title: a.title,
      status: a.status,
      perf: a.perf,
      axeCount: a.axeViolations.length,
      consoleErrorCount: a.consoleErrors.length,
      brokenLinkCount: a.brokenLinks.length,
      buttonsCount: a.buttonsCount,
      formsCount: a.formsCount,
      inputsCount: a.inputsCount,
      textSnippet: a.visibleText.slice(0, 600),
    }));

    return {
      finalUrl: entry.url,
      title: entry.title,
      status: entry.status,
      screenshotBase64: entry.screenshotBase64,
      mobileScreenshotBase64: entry.mobileScreenshotBase64,
      screenshotMediaType: "image/png",
      visibleText: entry.visibleText,
      links: Array.from(new Set(audits.flatMap((a) => a.links))).slice(0, 100),
      buttonsCount: entry.buttonsCount,
      formsCount: entry.formsCount,
      inputsCount: entry.inputsCount,
      consoleErrors: Array.from(new Set(audits.flatMap((a) => a.consoleErrors))).slice(0, 60),
      perf: entry.perf,
      axeViolations: Array.from(axeMap.values()).slice(0, 60),
      brokenLinks: Array.from(brokenMap.values()).slice(0, 50),
      securityHeaders: entry.securityHeaders,
      isHttps: entry.url.startsWith("https://"),
      pages,
      extraScreenshots: audits.slice(1, 3).map((a) => a.screenshotBase64).filter(Boolean),
      pagesAudited: audits.length,
    };
  } finally {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
}

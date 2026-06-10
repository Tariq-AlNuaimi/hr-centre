// Vibe Inspector — site capture via Browserbase over raw CDP (ADR-016).
//
// We talk to the remote Chromium directly over the Chrome DevTools Protocol on a
// WebSocket (the `ws` client) instead of bundling playwright-core — a heavy package
// whose data files don't trace cleanly into a Vercel serverless function. CDP gives
// us exactly what the analysis layer needs: a screenshot, visible text, links,
// control counts, the main-document status + security headers.
//
// Config (API key + project id) comes from Settings → Browser engine (DB) with an
// env fallback — see lib/testing/browser-config.ts. When unset, captureSite throws
// a clear, actionable error so the run is recorded as FAILED (never a false green).

import WebSocket from "ws";
import { resolveBrowserConfig } from "./browser-config";

export interface CaptureResult {
  finalUrl: string;
  title: string;
  status: number | null;
  screenshotBase64: string;
  screenshotMediaType: "image/png";
  visibleText: string;
  links: string[];
  buttonsCount: number;
  formsCount: number;
  inputsCount: number;
  consoleErrors: string[];
  securityHeaders: Record<string, string>;
  isHttps: boolean;
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

const CONNECT_BASE = "wss://connect.browserbase.com";

interface BrowserbaseSession {
  id: string;
}

async function createSession(apiKey: string, projectId: string): Promise<BrowserbaseSession> {
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

class Cdp {
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

  /** Resolve when `method` fires matching `predicate`, or reject after `timeoutMs`. */
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

// Runs in the page; returns the DOM signals the analysis layer uses.
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

/**
 * Capture a single page. The target URL is normalised to include a protocol.
 * Timeouts are bounded so a slow target can't blow the function's maxDuration.
 */
export async function captureSite(targetUrl: string): Promise<CaptureResult> {
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
        reject(e);
      });
    });

    const cdp = new Cdp(ws);

    const { targetId } = (await cdp.send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
    const { sessionId } = (await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as { sessionId: string };

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp
      .send(
        "Emulation.setDeviceMetricsOverride",
        { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false },
        sessionId
      )
      .catch(() => {});

    // Capture the main-document response (status + headers) as it arrives.
    let status: number | null = null;
    const rawHeaders: Record<string, string> = {};
    cdp.on("Network.responseReceived", (params, sid) => {
      if (sid !== sessionId) return;
      if (params.type !== "Document" || status !== null) return;
      const response = params.response as { status?: number; headers?: Record<string, string> } | undefined;
      if (response) {
        status = response.status ?? null;
        Object.assign(rawHeaders, response.headers ?? {});
      }
    });

    const loaded = cdp.waitFor("Page.loadEventFired", (_p, sid) => sid === sessionId, 25_000);
    try {
      await cdp.send("Page.navigate", { url }, sessionId);
    } catch (navErr) {
      throw new Error(`Could not load ${url}: ${navErr instanceof Error ? navErr.message : String(navErr)}`);
    }
    // Wait for load, but don't fail the whole run if 'load' never fires (SPAs) —
    // proceed after the bound and capture whatever rendered.
    await loaded.catch(() => {});
    await sleep(1000);

    const { data: screenshotBase64 } = (await cdp.send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: false },
      sessionId
    )) as { data: string };

    const evalRes = (await cdp.send(
      "Runtime.evaluate",
      { expression: PAGE_SCRIPT, returnByValue: true, awaitPromise: false },
      sessionId
    )) as { result?: { value?: PageData }; exceptionDetails?: unknown };
    const page: PageData = evalRes.result?.value ?? EMPTY_PAGE;

    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});

    const securityHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
      const key = k.toLowerCase();
      if (SECURITY_HEADER_NAMES.includes(key)) securityHeaders[key] = v;
    }

    const finalUrl = page.finalUrl || url;
    return {
      finalUrl,
      title: page.title,
      status,
      screenshotBase64,
      screenshotMediaType: "image/png",
      visibleText: page.text,
      links: page.links,
      buttonsCount: page.buttonsCount,
      formsCount: page.formsCount,
      inputsCount: page.inputsCount,
      consoleErrors: [], // not collected over raw CDP in the MVP
      securityHeaders,
      isHttps: finalUrl.startsWith("https://"),
    };
  } finally {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
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

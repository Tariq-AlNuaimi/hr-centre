// Vibe Inspector — site capture via Browserbase (ADR-016).
//
// Creates a hosted Chromium session on Browserbase via its REST API, connects to
// it over CDP with playwright-core (the browser is REMOTE — no Chromium binary in
// the bundle), navigates to the target, and captures the signals the analysis layer
// needs: a screenshot, visible text, links, control counts, console errors, and
// security-relevant response headers.
//
// Config (API key + project id) comes from Settings → Browser engine (DB) with an
// env fallback — see lib/testing/browser-config.ts. When unset, captureSite throws a
// clear, actionable error so the run is recorded as FAILED (never a false green) —
// the same graceful-degradation contract as lib/email.ts + SMTP_HOST.

import { chromium, type Response as PWResponse } from "playwright-core";
import { resolveBrowserConfig } from "./browser-config";

export interface CaptureResult {
  finalUrl: string;
  title: string;
  status: number | null;
  /** Viewport screenshot, base64-encoded PNG. */
  screenshotBase64: string;
  screenshotMediaType: "image/png";
  /** Trimmed visible text of the page. */
  visibleText: string;
  /** In-page link hrefs (deduped, capped). */
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

/**
 * Capture a single page. The target URL is normalised to include a protocol.
 * Timeouts are bounded so a slow target can't blow the function's maxDuration.
 */
export async function captureSite(targetUrl: string): Promise<CaptureResult> {
  const { apiKey, projectId } = await resolveBrowserConfig();

  const url = /^https?:\/\//i.test(targetUrl) ? targetUrl : `https://${targetUrl}`;
  const session = await createSession(apiKey, projectId);

  const browser = await chromium.connectOverCDP(
    `${CONNECT_BASE}?apiKey=${encodeURIComponent(apiKey)}&sessionId=${encodeURIComponent(session.id)}`
  );

  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize({ width: 1366, height: 900 });

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 500));
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err).slice(0, 500)));

    // A hard navigation failure (DNS, refused connection, timeout) must fail the
    // run honestly rather than scoring a blank about:blank page as if it loaded.
    let response: PWResponse | null = null;
    try {
      response = await page.goto(url, { waitUntil: "load", timeout: 25_000 });
    } catch (navErr) {
      const reason = navErr instanceof Error ? navErr.message : String(navErr);
      throw new Error(`Could not load ${url}: ${reason}`);
    }
    // Settle briefly for client-rendered content without waiting on networkidle forever.
    await page.waitForTimeout(1000);

    const finalUrl = page.url();
    const title = await page.title().catch(() => "");
    const status = response?.status() ?? null;

    const headers = response?.headers() ?? {};
    const securityHeaders: Record<string, string> = {};
    for (const name of SECURITY_HEADER_NAMES) {
      if (headers[name]) securityHeaders[name] = headers[name];
    }

    const screenshot = await page.screenshot({ type: "png", fullPage: false });
    const screenshotBase64 = screenshot.toString("base64");

    const page_data = await page.evaluate(() => {
      const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
      const hrefs = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h && !h.startsWith("javascript:"));
      return {
        text: text.slice(0, 12_000),
        links: Array.from(new Set(hrefs)).slice(0, 100),
        buttonsCount: document.querySelectorAll(
          "button, [role='button'], input[type='submit'], input[type='button']"
        ).length,
        formsCount: document.querySelectorAll("form").length,
        inputsCount: document.querySelectorAll("input, textarea, select").length,
      };
    });

    return {
      finalUrl,
      title,
      status,
      screenshotBase64,
      screenshotMediaType: "image/png",
      visibleText: page_data.text,
      links: page_data.links,
      buttonsCount: page_data.buttonsCount,
      formsCount: page_data.formsCount,
      inputsCount: page_data.inputsCount,
      consoleErrors: consoleErrors.slice(0, 50),
      securityHeaders,
      isHttps: finalUrl.startsWith("https://"),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

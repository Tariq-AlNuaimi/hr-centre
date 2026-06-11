// Vibe Inspector — HTML → PDF via the Browserbase browser (ADR-016).
//
// We already drive a remote Chromium over CDP for capture; reuse it to render a
// report HTML string to a real, shareable PDF with CDP Page.printToPDF. No local
// Chromium, no pdfkit (which the template avoids in serverless — see CLAUDE.md).

import WebSocket from "ws";
import { Cdp, createSession, CONNECT_BASE } from "./capture";
import { resolveBrowserConfig } from "./browser-config";
import { redactSecret } from "@/lib/secret-box";

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const { apiKey, projectId } = await resolveBrowserConfig();
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

    const dataUrl = `data:text/html;base64,${Buffer.from(html, "utf8").toString("base64")}`;
    const loaded = cdp.waitFor("Page.loadEventFired", (_p, sid) => sid === sessionId, 20_000);
    await cdp.send("Page.navigate", { url: dataUrl }, sessionId);
    await loaded.catch(() => {});

    const { data } = (await cdp.send(
      "Page.printToPDF",
      {
        printBackground: true,
        preferCSSPageSize: true,
        marginTop: 0.4,
        marginBottom: 0.4,
        marginLeft: 0.4,
        marginRight: 0.4,
      },
      sessionId
    )) as { data: string };

    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
    if (!data) throw new Error("PDF render produced no output");
    return Buffer.from(data, "base64");
  } finally {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
}

import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { withRateLimit, withAuth } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";

export const maxDuration = 120;

const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8 MB

// Extract plain text from an uploaded BRD/scope document so it can populate the
// assessment's brdText. Plain-text/markdown files are read client-side; this route
// handles PDFs (via Claude's native document support — no PDF-parser dependency).
export const POST = withRateLimit(
  withAuth(async (request: NextRequest) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return err(
        "Document parsing needs the analysis engine. Set ANTHROPIC_API_KEY, or paste the BRD text directly.",
        503
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { base64?: string; mediaType?: string }
      | null;
    const base64 = body?.base64;
    const mediaType = body?.mediaType ?? "application/pdf";

    if (!base64) return err("No document provided");
    if (mediaType !== "application/pdf") {
      return err("Only PDF upload is parsed here; paste text for other formats.");
    }
    // base64 is ~4/3 of the byte size.
    if (base64.length * 0.75 > MAX_PDF_BYTES) {
      return err("PDF too large (max 8 MB). Paste the text instead.", 413);
    }

    const client = new Anthropic();
    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            {
              type: "text",
              text:
                "Extract the full text content of this requirements/scope document as clean " +
                "markdown. Preserve headings, lists, and requirement statements. Output only the " +
                "extracted content — no preamble.",
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return ok({ text });
  }),
  { id: "brd-parse", limit: 15, windowMs: 60_000 }
);

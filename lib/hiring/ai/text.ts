/** Getting text out of model replies and uploaded documents (Interview Hub `lib/ai/*`). */

/** The JSON object in a model reply (fences and prose around it tolerated); `{ raw }` when there is none. */
export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through */
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  return { raw: text };
}

export const isRawOnly = (v: unknown) =>
  typeof v === "object" && v !== null && Object.keys(v).length === 1 && "raw" in v;

export type FileKind = "pdf" | "docx" | "unknown";

/** By the bytes first (PDF `%PDF-`, DOCX is a zip `PK`), the name only as a tie-breaker. */
export function detectFileKind(bytes: Uint8Array, fileName?: string): FileKind {
  const head = Buffer.from(bytes.subarray(0, 8));
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (
    head.subarray(0, 2).toString("latin1") === "PK" &&
    (fileName ?? "").toLowerCase().endsWith(".docx")
  )
    return "docx";
  if (head.subarray(0, 2).toString("latin1") === "PK") return "docx";
  return "unknown";
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : (text ?? "")).trim();
}

export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return (value ?? "").trim();
}

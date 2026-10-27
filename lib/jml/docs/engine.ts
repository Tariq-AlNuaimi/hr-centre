import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

/**
 * The document engine (ADR-083; HR Offboarding `document-engine.ts`). A
 * template is DATA: docxtemplater's default parser does property lookup only —
 * no `angular-parser`, nothing evaluates. Placeholders are an allowlist; none
 * is Restricted, so no money and no narrative can be merged.
 */

const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024;
const REQUIRED_PARTS = ["[Content_Types].xml", "word/document.xml"];

const TEMPLATE_PLACEHOLDERS = [
  "caseRef",
  "employeeName",
  "employeeExternalId",
  "jobTitle",
  "companyName",
  "directorateName",
  "departmentName",
  "exitType",
  "exitSubtype",
  "employmentType",
  "nationality",
  "noticeStartDate",
  "noticePeriodDays",
  "lastPhysicalWorkingDay",
  "lastDayOfService",
  "departureDate",
  "lineManagerName",
  "hrOwnerName",
  "issueDate",
  "documentTitle",
] as const;

export type MergeData = Partial<Record<(typeof TEMPLATE_PLACEHOLDERS)[number], string>>;
export type TemplateIssue = { field: string; message: string };

const PLACEHOLDER_RE = /\{([#^/]?)([A-Za-z0-9_.]+)\}/g;

/** Strip the XML so a placeholder Word split across runs is still seen whole. */
function textOf(xml: string): string {
  return xml.replace(/<[^>]+>/g, "");
}

export function validateTemplateBuffer(buffer: Buffer): {
  issues: TemplateIssue[];
  placeholders: string[];
} {
  if (buffer.byteLength === 0)
    return {
      issues: [{ field: "file", message: "The uploaded template is empty." }],
      placeholders: [],
    };
  if (buffer.byteLength > MAX_TEMPLATE_BYTES) {
    return {
      issues: [
        {
          field: "file",
          message: `Template is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is 2 MB. A merge template is a letter with placeholders — an oversized one usually carries embedded media.`,
        },
      ],
      placeholders: [],
    };
  }
  let zip: PizZip;
  try {
    zip = new PizZip(buffer);
  } catch {
    return {
      issues: [
        {
          field: "file",
          message:
            "This file is not a .docx. Save it as “Word Document (.docx)” — “Word 97-2003 (.doc)” will not work.",
        },
      ],
      placeholders: [],
    };
  }
  const issues: TemplateIssue[] = [];
  for (const part of REQUIRED_PARTS) {
    if (!zip.file(part))
      issues.push({
        field: "file",
        message: `The archive opens but is missing ${part}, so it is not a Word document.`,
      });
  }
  const text = textOf(zip.file("word/document.xml")?.asText() ?? "");
  const found = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) found.add(m[2]!);
  const allowed = new Set<string>(TEMPLATE_PLACEHOLDERS);
  const unknown = [...found].filter((p) => !allowed.has(p) && !allowed.has(p.split(".")[0]!));
  if (unknown.length > 0) {
    issues.push({
      field: "placeholders",
      message:
        `Unknown placeholder(s): ${unknown.map((u) => `{${u}}`).join(", ")}. A placeholder that names no case field renders EMPTY — a letter would silently lose a paragraph. ` +
        `Known fields: ${TEMPLATE_PLACEHOLDERS.map((a) => `{${a}}`).join(", ")}.`,
    });
  }
  return { issues, placeholders: [...found].sort() };
}

export function renderDocument(templateBuffer: Buffer, data: MergeData): Buffer {
  const doc = new Docxtemplater(new PizZip(templateBuffer), {
    paragraphLoop: true,
    linebreaks: true,
    // NO `parser` option (ADR-083 decision 1): the default parser evaluates nothing.
    nullGetter: () => "",
  });
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

export function docxHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
    "Cache-Control": "no-store",
  };
}

/** Summary dismissal: documents are held until these confirmations are done (Offboarding documents.ts). */
const SUMMARY_DISMISSAL_GATE_TASKS = ["S1-05", "S3-04", "S3-05", "S3-06", "S3-07"] as const;

export function summaryDismissalHold(
  exitType: string,
  tasks: readonly { code: string; status: string }[],
): string | null {
  if (exitType !== "SUMMARY_DISMISSAL") return null;
  const gate = tasks.filter((t) =>
    (SUMMARY_DISMISSAL_GATE_TASKS as readonly string[]).includes(t.code),
  );
  const open = gate.filter((t) => t.status !== "COMPLETED" && t.status !== "NOT_APPLICABLE");
  if (gate.length === 0)
    return "A summary dismissal's documents are held until its confirmation tasks exist and are done.";
  if (open.length > 0) {
    return `A summary dismissal's documents are held until ${open.map((t) => t.code).join(", ")} ${open.length === 1 ? "is" : "are"} complete or not applicable.`;
  }
  return null;
}

/** AC-17.1: only an ACTIVE template that someone approved may generate. */
export function generationProblem(t: {
  state: string;
  approvedAt: Date | null;
  isDefault: boolean;
}): string | null {
  if (t.state === "DRAFT") return "This template is a draft; an HR Manager must activate it first.";
  if (t.state === "RETIRED") return "This template is retired; generate from the active version.";
  if (!t.approvedAt && !t.isDefault) return "This template has not been approved.";
  return null;
}

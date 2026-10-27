import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import PizZip from "pizzip";

import {
  generationProblem,
  renderDocument,
  summaryDismissalHold,
  validateTemplateBuffer,
} from "../../lib/jml/docs/engine";
import { DOCUMENT_TYPE_VALUES } from "../../lib/validations/jml/leave";

/** JML S6b — Word documents (ADR-083): the nine defaults, the allowlist, no evaluation. */

const DIR = "prisma/jml-docs";

test("nine default templates, one per document type, each valid with allowlisted placeholders only", () => {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".docx"))
    .sort();
  assert.deepEqual(files, [...DOCUMENT_TYPE_VALUES].map((t) => `${t}.docx`).sort());
  for (const f of files) {
    const { issues, placeholders } = validateTemplateBuffer(readFileSync(`${DIR}/${f}`));
    assert.deepEqual(issues, [], f);
    assert.ok(placeholders.includes("caseRef"), f);
  }
});

test("rendering merges the case fields and nothing else", () => {
  const out = renderDocument(readFileSync(`${DIR}/ACCEPTANCE_OF_RESIGNATION.docx`), {
    caseRef: "EXIT-2026-0042",
    employeeName: "Aisha Al-Balushi",
    lastDayOfService: "2026-12-31",
  });
  const xml = new PizZip(out).file("word/document.xml")!.asText();
  assert.match(xml, /EXIT-2026-0042/);
  assert.match(xml, /Aisha Al-Balushi/);
  assert.doesNotMatch(xml, /\{caseRef\}/);
  // An unset field renders empty, not "undefined".
  assert.doesNotMatch(xml, /undefined/);
});

function docxWith(text: string): Buffer {
  const zip = new PizZip(readFileSync(`${DIR}/CERTIFICATE_OF_SERVICE.docx`));
  const xml = zip.file("word/document.xml")!.asText();
  zip.file("word/document.xml", xml.replace("To whom it may concern,", text));
  return zip.generate({ type: "nodebuffer" }) as Buffer;
}

test("unknown or Restricted placeholders are refused; not-a-docx and oversize are refused", () => {
  const unknown = validateTemplateBuffer(docxWith("Net payable: {netTotalAmount}"));
  assert.match(unknown.issues[0]!.message, /\{netTotalAmount\}/);
  // Word splits runs — the check reads the text, not the raw XML.
  const split = validateTemplateBuffer(
    docxWith('{narra</w:t></w:r><w:r><w:t xml:space="preserve">tive}'),
  );
  assert.match(split.issues[0]!.message, /\{narrative\}/);
  assert.match(validateTemplateBuffer(Buffer.from("%PDF-1.7")).issues[0]!.message, /not a \.docx/);
  assert.match(
    validateTemplateBuffer(Buffer.alloc(3 * 1024 * 1024, 1)).issues[0]!.message,
    /limit is 2 MB/,
  );
});

test("no expression is evaluated — the default parser only looks properties up", () => {
  const out = renderDocument(docxWith("{employeeName}"), { employeeName: "{process.exit(1)}" });
  assert.match(new PizZip(out).file("word/document.xml")!.asText(), /\{process\.exit\(1\)\}/);
});

test("AC-17.1 generation needs an approved active template; summary dismissal holds every document", () => {
  assert.match(generationProblem({ state: "DRAFT", approvedAt: null, isDefault: false })!, /draft/);
  assert.match(
    generationProblem({ state: "RETIRED", approvedAt: new Date(), isDefault: false })!,
    /retired/,
  );
  assert.equal(
    generationProblem({ state: "ACTIVE", approvedAt: new Date(), isDefault: false }),
    null,
  );
  assert.equal(generationProblem({ state: "ACTIVE", approvedAt: null, isDefault: true }), null);
  assert.equal(summaryDismissalHold("RESIGNATION", []), null);
  const tasks = ["S1-05", "S3-04", "S3-05", "S3-06", "S3-07"].map((code) => ({
    code,
    status: "COMPLETED",
  }));
  assert.equal(summaryDismissalHold("SUMMARY_DISMISSAL", tasks), null);
  assert.match(
    summaryDismissalHold("SUMMARY_DISMISSAL", [
      ...tasks.slice(1),
      { code: "S1-05", status: "IN_PROGRESS" },
    ])!,
    /S1-05 is complete/,
  );
  assert.ok(summaryDismissalHold("SUMMARY_DISMISSAL", []));
});

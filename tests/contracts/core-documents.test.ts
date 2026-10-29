import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sniffType } from "../../lib/core/documents/file-type";
import { documentUploadSchema } from "../../lib/validations/core/documents";

// ADR-098: the core document store and the Employee › Documents union.

test("a file is what its first bytes say", () => {
  assert.equal(sniffType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), "application/pdf");
  assert.equal(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), "image/png");
  assert.equal(
    sniffType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00])),
    null,
    "an executable is refused",
  );
});

test("upload fields: a title, a known kind, restricted only when asked", () => {
  assert.deepEqual(documentUploadSchema.parse({ title: " Contract ", category: "contract" }), {
    title: "Contract",
    category: "contract",
    restricted: false,
  });
  assert.equal(
    documentUploadSchema.parse({ title: "Pay", category: "letter", restricted: "true" }).restricted,
    true,
  );
  assert.equal(documentUploadSchema.safeParse({ title: "", category: "contract" }).success, false);
  assert.equal(documentUploadSchema.safeParse({ title: "x", category: "virus" }).success, false);
});

test("every route checks before it signs or writes; a stranger gets 404", () => {
  const read = readFileSync("app/api/employees/[id]/documents/[docId]/route.ts", "utf8");
  assert.match(read, /const l = await load\(/);
  assert.ok(read.indexOf("load(") < read.indexOf("documentReadUrl(l.doc)"), "sign after the check");
  assert.match(read, /doc\.restricted && !access\.restricted/);
  const access = readFileSync("lib/core/documents/access.ts", "utf8");
  assert.match(access, /canViewEmployee\(actor, employeeId, descendants\)/);
  assert.match(access, /canViewIdDocuments\(actor\)/);
  const upload = readFileSync("app/api/employees/[id]/documents/route.ts", "utf8");
  assert.match(upload, /if \(!access\) return notFound/);
  assert.match(upload, /if \(!access\.edit\)/);
});

test("each module's files are listed only under that module's own rule", () => {
  const union = readFileSync("lib/core/documents/employee-documents.ts", "utf8");
  assert.match(union, /canViewEvidence\(actor, employee\)/);
  assert.match(union, /restricted: false/);
  assert.match(
    readFileSync("lib/jml/employee-tab.ts", "utf8"),
    /if \(!\(await jmlTabVisible\(actor, employeeId\)\)\) return \[\]/,
  );
  const hiring = readFileSync("lib/hiring/employee-tab.ts", "utf8");
  assert.match(hiring, /if \(!can\(actor, "hiring\.manage", subject\)\) return \[\]/);
  assert.match(hiring, /pay \|\| !PAY_KINDS\.has\(d\.kind\)/);
});

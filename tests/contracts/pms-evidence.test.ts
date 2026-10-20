import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_PER_KPI,
  evidenceWriteBlockedReason,
  isAllowedContentType,
  linkBlockedReason,
  signBlockedReason,
  sniffContentType,
  uploadBlockedReason,
} from "../../lib/pms/evidence";
import { evidencePrefix, isWithinEvidencePrefix } from "../../lib/storage";
import type { PmsActor } from "../../lib/pms/permissions";

const actor = (employeeId: string | null = "emp-1"): PmsActor =>
  ({
    employeeId,
    pmsRoles: [],
    capabilities: {},
  }) as unknown as PmsActor;

const bytes = (...b: number[]) => Uint8Array.from(b);

// --- §7.1 the type allowlist -------------------------------------------------

test("the allowlist is an ALLOWLIST — anything unnamed is refused", () => {
  assert.equal(isAllowedContentType("application/pdf"), true);
  for (const bad of [
    "image/svg+xml", // executes script
    "text/html",
    "application/zip",
    "application/x-msdownload",
    "application/octet-stream",
  ]) {
    assert.equal(isAllowedContentType(bad), false, `${bad} must not be accepted`);
  }
});

test("the type is decided by MAGIC BYTES, not by what the uploader claims", () => {
  // The whole attack: a file named .pdf, declared application/pdf, that is
  // really something else. The declared type is not evidence of anything.
  const pdf = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31);
  assert.equal(sniffContentType(pdf, "application/pdf"), "application/pdf");

  const html = bytes(0x3c, 0x21, 0x44, 0x4f, 0x43); // <!DOC
  assert.equal(sniffContentType(html, "application/pdf"), null);

  const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  assert.equal(sniffContentType(png, "image/png"), "image/png");
  // A PNG declaring itself a PDF sniffs as what it IS, which is not what it
  // claimed — and the caller refuses on exactly that inequality.
  assert.equal(sniffContentType(png, "application/pdf"), "image/png");
});

test("the upload route ACTS on the mismatch — the sniffer is not decoration", () => {
  // A rule with no caller is a comment. In a client-upload flow the server
  // never sees the bytes on the way past, so the only place it can look is
  // after the upload completes — and it must delete what it refuses, or the
  // blob survives without a row pointing at it.
  const route = readFileSync("app/api/year-end/evidence/route.ts", "utf8");
  const completed = route.slice(route.indexOf("onUploadCompleted"));
  assert.match(completed, /sniffContentType\(/, "the completion callback must sniff the bytes");
  assert.match(
    completed,
    /sniffed !== p\.contentType/,
    "it must compare what the file IS against what it CLAIMED",
  );
  assert.match(
    completed.slice(completed.indexOf("sniffed !== p.contentType")),
    /deleteStoredFile\(/,
    "a refused upload must not leave its bytes behind",
  );
});

test("a ZIP signature is only accepted for the three OOXML types", () => {
  const zip = bytes(0x50, 0x4b, 0x03, 0x04);
  const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  assert.equal(sniffContentType(zip, docx), docx);
  // A plain archive renamed .docx is refused: `application/zip` is not on the
  // allowlist, so it can never be the declared type in the first place.
  assert.equal(sniffContentType(zip, "application/zip"), null);
  assert.equal(sniffContentType(zip, "application/pdf"), null);
});

test("a binary claiming to be text is refused on the NUL byte", () => {
  // Text formats have no signature, so they are taken on the declared type —
  // which would be a hole if a binary could claim `text/plain`.
  assert.equal(sniffContentType(bytes(0x68, 0x69, 0x0a), "text/plain"), "text/plain");
  assert.equal(sniffContentType(bytes(0x68, 0x00, 0x69), "text/plain"), null);
});

// --- §7.1 the size and count caps -------------------------------------------

test("a file over 10 MB is refused, and the message says by how much", () => {
  const refusal = uploadBlockedReason({
    contentType: "application/pdf",
    sizeBytes: MAX_EVIDENCE_BYTES + 1,
    existingCount: 0,
  });
  assert.ok(refusal);
  assert.equal(refusal.status, 413);
  assert.match(refusal.reason, /10 MB per file/);
});

test("an empty file is refused — it is not evidence of anything", () => {
  const refusal = uploadBlockedReason({
    contentType: "application/pdf",
    sizeBytes: 0,
    existingCount: 0,
  });
  assert.ok(refusal);
  assert.equal(refusal.status, 400);
});

test("the 11th item on one KPI is refused, by both routes", () => {
  const atLimit = { existingCount: MAX_EVIDENCE_PER_KPI };
  const file = uploadBlockedReason({ contentType: "application/pdf", sizeBytes: 10, ...atLimit });
  const link = linkBlockedReason({ url: "https://a.test/x", ...atLimit });
  for (const r of [file, link]) {
    assert.ok(r);
    assert.equal(r.status, 409);
    assert.match(r.reason, /limit of 10/);
  }
});

test("a file exactly at the limit is accepted — the cap is inclusive", () => {
  assert.equal(
    uploadBlockedReason({
      contentType: "application/pdf",
      sizeBytes: MAX_EVIDENCE_BYTES,
      existingCount: 0,
    }),
    null,
  );
});

// --- §7.1 links --------------------------------------------------------------

test("only http(s) links are accepted", () => {
  assert.equal(linkBlockedReason({ url: "https://drive.test/x", existingCount: 0 }), null);
  assert.equal(linkBlockedReason({ url: "http://intranet.test/x", existingCount: 0 }), null);

  for (const bad of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html;base64,PHNjcmlwdD4=",
    "not a url at all",
  ]) {
    const r = linkBlockedReason({ url: bad, existingCount: 0 });
    assert.ok(r, `${bad} must be refused`);
    assert.equal(r.status, 400);
  }
});

// --- §7.1 who may write ------------------------------------------------------

test("only the subject may add or remove their own evidence", () => {
  const mine = evidenceWriteBlockedReason({
    actor: actor("emp-1"),
    subjectEmployeeId: "emp-1",
    employeeSigned: false,
  });
  assert.equal(mine, null);

  // A manager, HR, or anyone else: 404, never 403. A 403 confirms the item is
  // real, which is the thing §4.2 refuses to do everywhere else.
  for (const who of ["mgr-1", "hr-1"]) {
    const r = evidenceWriteBlockedReason({
      actor: actor(who),
      subjectEmployeeId: "emp-1",
      employeeSigned: false,
    });
    assert.ok(r);
    assert.equal(r.status, 404);
  }
});

test("an account with no employee record cannot write evidence", () => {
  const r = evidenceWriteBlockedReason({
    actor: actor(null),
    subjectEmployeeId: "emp-1",
    employeeSigned: false,
  });
  assert.ok(r);
  assert.equal(r.status, 404);
});

test("the employee's own signature closes the record", () => {
  const r = evidenceWriteBlockedReason({
    actor: actor("emp-1"),
    subjectEmployeeId: "emp-1",
    employeeSigned: true,
  });
  assert.ok(r);
  assert.equal(r.status, 409);
  assert.match(r.reason, /signed/);
});

// --- §7.1 the sign-off gate — the point of the whole feature -----------------

const kpi = (
  over: Partial<{
    id: string;
    description: string;
    hasRating: boolean;
    evidenceCount: number;
  }> = {},
) => ({
  id: "k1",
  description: "Delivery",
  hasRating: true,
  evidenceCount: 1,
  ...over,
});

test("a complete set signs", () => {
  assert.equal(signBlockedReason({ kpis: [kpi(), kpi({ id: "k2" })] }), null);
});

test("a missing RATING blocks the signature and names the KPI", () => {
  const r = signBlockedReason({
    kpis: [kpi(), kpi({ id: "k2", description: "Quality", hasRating: false })],
  });
  assert.ok(r);
  assert.equal(r.status, 409);
  assert.match(r.reason, /1 of 2 KPIs still need a rating/);
  assert.match(r.reason, /Quality/);
});

test("missing EVIDENCE blocks the signature just as hard — HR's rule", () => {
  // The requirement the feature exists for: a rating with nothing behind it is
  // exactly the state this closes.
  const r = signBlockedReason({
    kpis: [kpi(), kpi({ id: "k2", description: "Collaboration", evidenceCount: 0 })],
  });
  assert.ok(r);
  assert.equal(r.status, 409);
  assert.match(r.reason, /still need evidence/);
  assert.match(r.reason, /Collaboration/);
});

test("ratings are reported BEFORE evidence — one instruction at a time", () => {
  // A KPI missing both should say "rate it", not "rate it and also attach
  // something": the second is unreachable until the first is done.
  const r = signBlockedReason({
    kpis: [kpi({ hasRating: false, evidenceCount: 0 })],
  });
  assert.ok(r);
  assert.match(r.reason, /need a rating/);
  assert.doesNotMatch(r.reason, /need evidence/);
});

test("an empty KPI set cannot be signed at all", () => {
  const r = signBlockedReason({ kpis: [] });
  assert.ok(r);
  assert.match(r.reason, /no KPIs/);
});

// --- the upload location is pinned to the authorised KPI ---------------------

test("the client cannot choose a pathname outside its own KPI", () => {
  // Vercel's client-upload protocol lets the BROWSER propose the pathname and
  // the server only approves a token for it. Without this, an employee could
  // request a token for somebody else's folder and write into their evidence.
  const ok = evidencePrefix("p1", "k1") + "abc-report.pdf";
  assert.equal(isWithinEvidencePrefix({ pathname: ok, participantId: "p1", kpiId: "k1" }), true);

  for (const bad of [
    evidencePrefix("p2", "k1") + "x.pdf", // another participant
    evidencePrefix("p1", "k2") + "x.pdf", // another KPI
    evidencePrefix("p1", "k1") + "../../p2/k1/x.pdf", // traversal
    evidencePrefix("p1", "k1") + "sub/dir.pdf", // extra segment
    evidencePrefix("p1", "k1"), // empty name
    "year-end/x.pdf",
  ]) {
    assert.equal(
      isWithinEvidencePrefix({ pathname: bad, participantId: "p1", kpiId: "k1" }),
      false,
      `${bad} must be refused`,
    );
  }
});

// --- the storage module may never go public ----------------------------------

test("evidence storage is PRIVATE, and nothing may set it otherwise", () => {
  // Source-level, because this is the one property that cannot be recovered
  // from: a public blob URL is a permanent unauthenticated handle to a
  // Confidential record, and it cannot be un-published once copied. The
  // `/scale-up` recipe this replaced hardcoded `access: "public"`.
  const route = readFileSync("app/api/year-end/evidence/route.ts", "utf8");
  const tokenBlock = route.slice(route.indexOf("onBeforeGenerateToken"));
  assert.match(
    tokenBlock.slice(0, tokenBlock.indexOf("tokenPayload")),
    /access:\s*"private"/,
    "the upload token must grant PRIVATE access",
  );

  // Comments are stripped first: the module's own header explains why the
  // `/scale-up` recipe's `access: "public"` was rejected, and an assertion
  // that cannot tell prose from code would fail on its own explanation.
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const storage = code(readFileSync("lib/storage.ts", "utf8"));
  assert.match(storage, /access:\s*"private"/, "signed reads must be against the private store");
  assert.doesNotMatch(storage, /access:\s*"public"/, "storage must never mint public access");

  // The browser's own call declares it too. The server grants what the TOKEN
  // says, not what this declares, so a mismatch would surface only against a
  // real store — which this container cannot reach.
  const client = code(readFileSync("components/pms/KpiEvidence.tsx", "utf8"));
  assert.doesNotMatch(client, /access:\s*"public"/, "the client upload must not declare public");
});

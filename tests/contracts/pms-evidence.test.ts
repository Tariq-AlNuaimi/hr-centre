import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_PER_KPI,
  canViewEvidence,
  evidenceWriteBlockedReason,
  isAllowedContentType,
  linkBlockedReason,
  signBlockedReason,
  sniffContentType,
  uploadBlockedReason,
} from "../../lib/pms/evidence";
import { evidencePrefix, isWithinEvidencePrefix } from "../../lib/storage";
import type { PmsActor } from "../../lib/pms/permissions";

const actor = (employeeId: string | null = "emp-1", roles: string[] = []): PmsActor =>
  ({
    employeeId,
    pmsRoles: roles,
    capabilities: {},
  }) as unknown as PmsActor;

const NOW = new Date("2026-10-20T12:00:00Z");

/** An open year-end window, so each test states only what it is about. */
const OPEN_STAGE = {
  kind: "YEAR_END",
  opensAt: new Date("2026-10-01T00:00:00Z"),
  deadline: new Date("2026-11-30T00:00:00Z"),
  graceDays: 0,
} as never;

const write = (over: Record<string, unknown> = {}) =>
  evidenceWriteBlockedReason({
    actor: actor("emp-1"),
    subjectEmployeeId: "emp-1",
    employeeSigned: false,
    roleTrack: "STANDARD" as never,
    goalsApprovedAt: new Date("2026-02-01T00:00:00Z"),
    stage: OPEN_STAGE,
    cycleStatus: "OPEN" as never,
    now: NOW,
    ...over,
  } as never);

const bytes = (...b: number[]) => Uint8Array.from(b);

/** Source assertions read CODE. A comment describing a bug is not the bug. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

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

test("the confirm path ACTS on the mismatch — the sniffer is not decoration", () => {
  // A rule with no caller is a comment, and this one had no caller twice over.
  // First it was never called at all. Then it was called from Vercel's
  // `onUploadCompleted`, which arrives with no session and is answered 401 by
  // both the middleware and `withAuth` — so the sniff, and the row, and the
  // delete all lived behind a 401 nobody saw. It now runs in the authenticated
  // confirm, which is the first point the server can both read the bytes AND
  // know who is asking.
  const route = readFileSync("app/api/year-end/evidence/route.ts", "utf8");
  assert.doesNotMatch(
    route,
    /onUploadCompleted:\s*async/,
    "the unauthenticated callback must not be the thing that creates rows",
  );

  const confirmAt = route.indexOf("async function handleConfirm");
  assert.ok(confirmAt > 0, "there must be a confirm handler");
  const confirm = route.slice(confirmAt, route.indexOf("async function handleLink"));
  assert.match(confirm, /sniffContentType\(/, "confirm must sniff the stored bytes");
  assert.match(
    confirm,
    /sniffContentType\(head\.bytes, contentType\) !== contentType/,
    "it must compare what the file IS against what it CLAIMED",
  );
  assert.match(
    confirm.slice(confirm.indexOf("sniffContentType(head.bytes")),
    /deleteStoredFile\(/,
    "a refused upload must not leave its bytes behind",
  );
  // The unreadable case is handled before the sniff, because an error document
  // read AS the file sniffs as a mismatch for every binary type — deleting a
  // file the employee legitimately uploaded — and passes for every text one.
  assert.match(
    confirm.slice(0, confirm.indexOf("sniffContentType")),
    /if \(!head\)/,
    "a file that cannot be read back must be refused, not sniffed",
  );
  assert.match(
    confirm.slice(0, confirm.indexOf("readStoredHead")),
    /writeRefusal\(/,
    "confirm must re-check the rules from the database, not trust the token",
  );
});

test("the handshake returns RAW json — an envelope would break the upload", () => {
  // `ok()` wraps every other response in `{ data: … }`, which is right for our
  // own clients and wrong for exactly one caller: the Blob SDK reads
  // `clientToken` at the top level. This was the second reason no file could
  // upload, and it is invisible in isolation — both halves look correct.
  const route = readFileSync("app/api/year-end/evidence/route.ts", "utf8");
  const handshake = route.slice(
    route.indexOf("handleUpload({"),
    route.indexOf("async function handleConfirm"),
  );
  assert.match(handshake, /NextResponse\.json\(result\)/);
  assert.doesNotMatch(handshake, /return ok\(result\)/);
});

test("the client proposes a pathname the server's own pin can accept", () => {
  // These two are written in different files by different hands and nothing
  // type-checks one against the other: the server pins uploads to
  // `year-end/<participantId>/<kpiId>/` and the client used to send
  // `year-end/pending/<filename>`, which that pin can never accept. Every file
  // upload was refused, and both sides read as correct on their own.
  // Comments stripped first. The component's own comment explains the stale
  // path it replaced, and an assertion that cannot tell prose from code fails
  // on the explanation — which is the third time that has happened in this
  // feature, so it is now the default here.
  const client = stripComments(readFileSync("components/pms/KpiEvidence.tsx", "utf8"));
  assert.doesNotMatch(client, /year-end\/pending\//, "the stale literal must be gone");
  assert.match(
    client,
    /`year-end\/\$\{participantId\}\/\$\{kpiId\}\//,
    "the client must build the prefix the server authorises",
  );

  // And the basename must not be the user's filename: `isWithinEvidencePrefix`
  // accepts [A-Za-z0-9._-] only, so a space or an Arabic character would fail
  // the path — in an RTL product that is the common case, not the edge.
  assert.match(client, /crypto\.randomUUID\(\)/, "the stored basename is generated");
  const uuidPath = `year-end/p1/k1/${"0".repeat(8)}-abc.pdf`;
  assert.equal(
    isWithinEvidencePrefix({ pathname: uuidPath, participantId: "p1", kpiId: "k1" }),
    true,
    "the shape the client now builds must satisfy the server's pin",
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
  assert.equal(write(), null);

  // A manager, HR, or anyone else: 404, never 403. A 403 confirms the item is
  // real, which is the thing §4.2 refuses to do everywhere else.
  for (const who of ["mgr-1", "hr-1"]) {
    const r = write({ actor: actor(who) });
    assert.ok(r);
    assert.equal(r.status, 404);
  }
});

test("an account with no employee record cannot write evidence", () => {
  const r = write({ actor: actor(null) });
  assert.ok(r);
  assert.equal(r.status, 404);
});

test("the employee's own signature closes the record", () => {
  const r = write({ employeeSigned: true });
  assert.ok(r);
  assert.equal(r.status, 409);
  assert.match(r.reason, /signed/);
});

// --- §5.4 — the deadline lock applies to EVIDENCE, not only to ratings ------

test("evidence is frozen once the year-end deadline passes (requirement 6)", () => {
  // The scenario this closes: the deadline passes with one KPI unevidenced, so
  // she can never sign — and therefore, under the first version of this rule,
  // could keep adding and DELETING evidence straight through calibration.
  const r = write({ now: new Date("2026-12-01T00:00:00Z") });
  assert.ok(r);
  assert.equal(r.status, 409);
  assert.match(r.reason, /deadline has passed/);
  assert.match(r.reason, /§5\.5/, "it should name HR's route past the lock");
});

test("evidence cannot be attached before the window opens", () => {
  const r = write({ now: new Date("2026-09-01T00:00:00Z") });
  assert.ok(r);
  assert.match(r.reason, /has not opened yet/);
});

test("a closed cycle freezes evidence too", () => {
  for (const status of ["CLOSED", "DRAFT"]) {
    const r = write({ cycleStatus: status });
    assert.ok(r, `${status} must refuse`);
    assert.equal(r.status, 409);
  }
});

test("no approved baseline means nothing to evidence (§5.1)", () => {
  const r = write({ goalsApprovedAt: null });
  assert.ok(r);
  assert.match(r.reason, /baseline/);
});

test("a C-Level participant has no self-assessment to evidence (§8.3)", () => {
  const r = write({ roleTrack: "C_LEVEL" });
  assert.ok(r);
  assert.match(r.reason, /C-Level/);
});

test("identity is checked BEFORE the cycle state, so a stranger learns nothing", () => {
  // A 404 either way, but the REASON must not differ: "the deadline has passed"
  // to someone with no claim on the record confirms the record exists.
  const r = write({ actor: actor("someone-else"), now: new Date("2027-06-01T00:00:00Z") });
  assert.ok(r);
  assert.equal(r.status, 404);
  assert.doesNotMatch(r.reason, /deadline|cycle|baseline/);
});

// --- who may SEE an item ----------------------------------------------------

test("evidence is visible to the subject, their DIRECT manager and HR — nobody else", () => {
  const subject = { id: "emp-1", managerId: "mgr-1" };

  assert.equal(canViewEvidence(actor("emp-1"), subject), true, "the subject");
  assert.equal(canViewEvidence(actor("mgr-1"), subject), true, "the direct manager");
  assert.equal(canViewEvidence(actor("hr-9", ["HRBP"]), subject), true, "HRBP");
  assert.equal(canViewEvidence(actor("hr-8", ["HR_SUPER_ADMIN"]), subject), true, "HR super admin");

  // The point of this predicate existing. `canViewEmployee` returns TRUE for
  // both of these — the whole downward chain, plus anyone org-wide — and while
  // that is the right rule for a rating on a five-point scale, an evidence item
  // is a file the employee chose and can contain anything. The blueprint and
  // SECURITY.md §1 both promised these two a 404 while the code was handing
  // them the file list.
  assert.equal(
    canViewEvidence(actor("skip-1"), subject),
    false,
    "a skip-level manager must not see the files",
  );
  assert.equal(
    canViewEvidence(actor("coo-1", ["EXECUTIVE_VIEWER"]), subject),
    false,
    "the executive viewer is read-only org-wide but not on evidence",
  );
  assert.equal(canViewEvidence(actor(null), subject), false, "no employee record");
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
  const code = stripComments;

  const storage = code(readFileSync("lib/storage.ts", "utf8"));
  assert.match(storage, /access:\s*"private"/, "signed reads must be against the private store");
  assert.doesNotMatch(storage, /access:\s*"public"/, "storage must never mint public access");

  // The browser's own call declares it too. The server grants what the TOKEN
  // says, not what this declares, so a mismatch would surface only against a
  // real store — which this container cannot reach.
  const client = code(readFileSync("components/pms/KpiEvidence.tsx", "utf8"));
  assert.doesNotMatch(client, /access:\s*"public"/, "the client upload must not declare public");
});

test("the storage read refuses a non-OK response rather than returning its body", () => {
  // `readStoredHead` is the only thing that sees the HTTP status, so it is the
  // only thing that can refuse on it. The route's `if (!head)` is downstream of
  // this check, not a substitute for it.
  const storage = stripComments(readFileSync("lib/storage.ts", "utf8"));
  const fn = storage.slice(storage.indexOf("export async function readStoredHead"));
  assert.match(fn, /if \(!res\.ok\) return null;/);
  assert.match(fn, /Range: "bytes=0-63"/, "a constant read, whatever the file's size");
});

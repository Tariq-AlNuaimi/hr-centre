import { before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  idFromSlug,
  jdBlocks,
  jobPostingJsonLd,
  roleSlug,
  scriptSafeJson,
} from "../../lib/hiring/careers-jd";
import { isPastTargetClose } from "../../lib/hiring/requisition-rules";
import {
  BOARD_STEPS,
  LINEAR_STAGES,
  nextOwner,
  stagesForStep,
  stepForStage,
} from "../../lib/hiring/stage-rules";
import { isPublicPath } from "../../i18n/route-decision";

/**
 * UX P1 phase 9 (docs/blueprints/ux-p1-hiring.md): one stage vocabulary, the
 * board's next-move owner, where a requisition is stuck, per-role careers pages.
 */

test("every active stage belongs to exactly one phase, and the phase filter is its inverse", () => {
  const all = BOARD_STEPS.flatMap((s) => stagesForStep(s));
  assert.deepEqual([...all].sort(), [...LINEAR_STAGES].sort());
  for (const s of BOARD_STEPS) for (const st of stagesForStep(s)) assert.equal(stepForStage(st), s);
  assert.deepEqual(stagesForStep(3), ["FIRST_INTERVIEW", "SECOND_INTERVIEW", "FINAL_INTERVIEW"]);
});

test("the board says whose move it is", () => {
  assert.equal(nextOwner("NEW_APPLICATION", false), "recruiter");
  assert.equal(nextOwner("SHORTLISTED", false), "manager");
  assert.equal(nextOwner("SECOND_INTERVIEW", false), "panel");
  assert.equal(nextOwner("DECISION_PENDING", false), "manager");
  assert.equal(nextOwner("OFFER_DRAFTED", true), "approvers");
  assert.equal(nextOwner("OFFER_EXTENDED", true), "candidate");
  // An offer stage with no offer record is the recruiter still drafting it.
  assert.equal(nextOwner("OFFER_EXTENDED", false), "recruiter");
  assert.equal(nextOwner("HIRED", true), null);
  assert.equal(nextOwner("NOT_A_STAGE", false), null);
});

test("a role's slug is readable and always ends in its id", () => {
  const id = "cmvr6sie40003ia7d4z63r6vm";
  const slug = roleSlug("Senior Data Engineer (Ops) — Muscat", id);
  assert.equal(slug, `senior-data-engineer-ops-muscat-${id}`);
  assert.equal(idFromSlug(slug), id);
  assert.equal(roleSlug("مهندس", id), id, "a title with no latin letters is just the id");
  assert.equal(idFromSlug("senior-data-engineer"), null);
  assert.equal(idFromSlug("x-../../etc"), null);
});

test("a JD renders as headings, paragraphs and lists — and markup stays text", () => {
  const blocks = jdBlocks(
    "## About the role\nYou will **design** APIs\nand [ship](https://x) them.\n\n- Go\n- `SQL`\n\n<script>alert(1)</script>",
  );
  assert.deepEqual(blocks, [
    { kind: "heading", text: "About the role" },
    { kind: "paragraph", text: "You will design APIs and ship them." },
    { kind: "list", items: ["Go", "SQL"] },
    { kind: "paragraph", text: "<script>alert(1)</script>" },
  ]);
  assert.deepEqual(jdBlocks(""), []);
});

test("JobPosting structured data cannot close its script tag", () => {
  const ld = jobPostingJsonLd({
    title: "Engineer </script><script>alert(1)</script>",
    description: "Build things & more",
    company: "Rihal",
    postedAt: "2026-10-20T08:00:00.000Z",
    validThrough: null,
    url: "https://hr.example/en/careers/engineer-cmvr6sie40003ia7d4z63r6vm",
    location: { city: "Muscat", country: "OM", arrangement: "ON_SITE" },
  });
  assert.equal(ld["@type"], "JobPosting");
  assert.equal(ld.datePosted, "2026-10-20");
  assert.ok(!("validThrough" in ld));
  const json = scriptSafeJson(ld);
  assert.ok(!json.includes("</script"));
  assert.ok(!json.includes("<"));
  assert.deepEqual(JSON.parse(json), ld);
});

test("past target close flags only requisitions still being hired for", () => {
  const now = new Date("2026-10-27T00:00:00Z").getTime();
  assert.equal(isPastTargetClose("OPEN", "2026-10-01", now), true);
  assert.equal(isPastTargetClose("PENDING_APPROVAL", "2026-10-01", now), true);
  assert.equal(isPastTargetClose("FILLED", "2026-10-01", now), false);
  assert.equal(isPastTargetClose("OPEN", "2026-11-01", now), false);
  assert.equal(isPastTargetClose("OPEN", null, now), false);
});

test("a role page is public, under the existing candidate paths", () => {
  assert.equal(isPublicPath("/en/careers/senior-data-engineer-cmvr6sie40003ia7d4z63r6vm"), true);
  const page = readFileSync("app/[locale]/(careers)/careers/[slug]/page.tsx", "utf8");
  assert.match(page, /if \(!role\) notFound\(\)/);
  assert.match(page, /__html: scriptSafeJson\(jsonLd\)/);
  assert.ok(!readFileSync("components/hiring/careers/JdBody.tsx", "utf8").includes("dangerously"));
  const careers = readFileSync("lib/hiring/careers.ts", "utf8");
  const openRole = careers.slice(careers.indexOf("export const openRole"));
  assert.match(openRole, /status: "OPEN"/);
  assert.match(openRole, /jdApprovedAt: \{ not: null \}/);
  assert.ok(!/salaryBand/.test(openRole.slice(0, openRole.indexOf("/** Is this requisition"))));
});

test("the board's manager filter narrows inside the reader's scope", () => {
  const src = readFileSync("lib/hiring/candidate-views.ts", "utf8");
  assert.match(src, /AND: \[scope, \{ stage: \{ notIn: \["REJECTED", "WITHDRAWN"\] \} \}\]/);
  assert.match(src, /\{ requisition: \{ hiringManagerId \} \}/);
  assert.match(
    readFileSync("app/api/hiring/candidates/board/route.ts", "utf8"),
    /loadRequisition\(actor, q\.data\.requisitionId, "hiring\.manage"\)/,
  );
});

const mockApi = mock as unknown as {
  module: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const calls: string[] = [];
let pending: typeof import("../../lib/hiring/requisition-pending");

before(async () => {
  const day = (d: string) => new Date(`2026-10-${d}T08:00:00Z`);
  mockApi.module(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        orgEntity: {
          findMany: async () => (calls.push("entity"), [{ id: "e1", code: "RIHAL" }]),
        },
        hiringRequisitionStatusHistory: {
          findMany: async () => (
            calls.push("history"),
            [
              { id: "s-a", requisitionId: "a", changedAt: day("20") },
              { id: "s-b2", requisitionId: "b", changedAt: day("15") },
              { id: "s-b1", requisitionId: "b", changedAt: day("01") },
            ]
          ),
        },
        hiringRequisitionApproval: {
          findMany: async () => (
            calls.push("approvals"),
            [
              {
                submissionId: "s-b2",
                sequence: 1,
                requiredRole: "HR_MANAGER",
                createdAt: day("24"),
              },
            ]
          ),
        },
      },
    },
  });
  mockApi.module(import.meta.resolve("../../lib/hiring/settings.ts"), {
    namedExports: { readSetting: async () => null, asNumber: (_: unknown, d: number) => d },
  });
  pending = await import("../../lib/hiring/requisition-pending");
});

test("a pending requisition names the step it waits on and for how long — in batched reads", async () => {
  const row = (id: string, status = "PENDING_APPROVAL") => ({
    id,
    status,
    entityId: "e1",
    salaryBandMax: 1200,
    salaryCurrency: "OMR",
  });
  const out = await pending.pendingSteps(
    [row("a"), row("b"), row("c", "OPEN")],
    new Date("2026-10-27T09:00:00Z"),
  );
  assert.deepEqual(out.get("a"), { role: "HR manager", days: 7 });
  // b's current round is its latest submission; HR signed on the 24th.
  assert.deepEqual(out.get("b"), { role: "Operations director", days: 3 });
  assert.equal(out.has("c"), false);
  assert.deepEqual(calls.sort(), ["approvals", "entity", "history"], "one read per signal");
  assert.equal((await pending.pendingSteps([row("x", "OPEN")])).size, 0);
});

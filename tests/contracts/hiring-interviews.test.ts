import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  asPanelAiMode,
  buildRoundPlan,
  canReveal,
  interviewEndsAt,
  resolveBriefForRound,
  scheduleStatus,
} from "../../lib/hiring/interview-rules";
import { buildIcs, escapeIcs, foldLine } from "../../lib/hiring/ics";
import {
  aggregateVerdict,
  competencyAverages,
  coverageOf,
  describeRounds,
  prepareScorecard,
  voteDivergence,
  weightedOverall,
} from "../../lib/hiring/scorecard-math";
import {
  comparisonActionSchema,
  createInterviewSchema,
  panelReviseSchema,
  panelScoreSchema,
  roundPlanSchema,
} from "../../lib/validations/hiring/interview";

const card = (o: Partial<Parameters<typeof prepareScorecard>[0]>) =>
  prepareScorecard({
    candidateId: "c1",
    interviewId: "i1",
    panelistId: "p1",
    round: 1,
    submitted: true,
    vote: "HIRE",
    scores: {},
    ...o,
  });

test("round plan: configured rounds in their order, scheduled-only rounds inferred after", () => {
  const plan = buildRoundPlan(
    [
      { round: "FINAL", roundOrder: 2, competencies: ["Leadership"], durationMinutes: 45 },
      { round: "TECHNICAL", roundOrder: 1, competencies: ["System design"], durationMinutes: 0 },
    ],
    ["SCREENING", "TECHNICAL"],
  );
  assert.deepEqual(
    plan.map((e) => [e.round, e.ordinal, e.durationMinutes, e.configured]),
    [
      ["TECHNICAL", 1, 60, true],
      ["FINAL", 2, 45, true],
      ["SCREENING", 3, 60, false],
    ],
  );
  assert.equal(resolveBriefForRound(plan, "PANEL").ordinal, 0, "an unplanned round has no ordinal");
  assert.equal(
    interviewEndsAt(new Date("2026-10-26T06:00:00Z"), 45).toISOString(),
    "2026-10-26T06:45:00.000Z",
  );
});

test("schedule status: lifecycle wins, then panel, then RSVP count", () => {
  assert.equal(scheduleStatus("CANCELLED", []).code, "CANCELLED");
  assert.equal(scheduleStatus("SCHEDULED", []).code, "NO_PANEL");
  const two = [{ confirmedAt: "2026-10-20" }, { confirmedAt: null }];
  assert.deepEqual(scheduleStatus("SCHEDULED", two), {
    code: "INVITES_SENT",
    confirmed: 1,
    total: 2,
  });
  assert.equal(scheduleStatus("SCHEDULED", [two[0]]).code, "CONFIRMED");
});

test("reveal: blind waits for my submission, assisted is open, off never opens", () => {
  assert.equal(canReveal("blind", false), false);
  assert.equal(canReveal("blind", true), true);
  assert.equal(canReveal("assisted", false), true);
  assert.equal(canReveal("off", true), false);
  assert.equal(asPanelAiMode("nonsense"), "blind", "anything unknown is the safe default");
});

test("matrix: means over SUBMITTED scorecards only, forgiving key match, equal weight", () => {
  const cards = [
    card({ scores: { "System design": 4, Communication: 2 } }),
    card({ panelistId: "p2", scores: { "system-design": 2 } }),
    card({ panelistId: "p3", submitted: false, scores: { "System design": 5 } }),
  ];
  const avg = competencyAverages(["System design", "Communication", "Ownership"], cards);
  assert.deepEqual(
    avg.map((a) => [a.mean, a.count]),
    [
      [3, 2],
      [2, 1],
      [null, 0],
    ],
  );
  assert.equal(weightedOverall(avg), 2.5);
  const cov = coverageOf(cards, (id) => id.toUpperCase());
  assert.deepEqual([cov.expected, cov.submitted, cov.outstanding, cov.complete], [3, 2, 1, false]);
  assert.equal(cov.missing[0].panelistName, "P3");
});

test("verdict: a draft's placeholder vote never counts; latest round per panelist", () => {
  const v = aggregateVerdict([
    card({ vote: "NO_HIRE", round: 1 }),
    card({ vote: "STRONG_HIRE", round: 2 }),
    card({ panelistId: "p2", vote: "STRONG_HIRE" }),
    card({ panelistId: "p3", submitted: false, vote: "HIRE" }),
  ]);
  assert.equal(v.total, 2);
  assert.equal(v.unanimous, "STRONG_HIRE");
  assert.equal(v.majority, "STRONG_HIRE");
  const split = aggregateVerdict([
    card({ vote: "HIRE" }),
    card({ panelistId: "p2", vote: "NO_HIRE" }),
  ]);
  assert.deepEqual([split.unanimous, split.majority, split.positive], [null, null, 1]);
  assert.equal(describeRounds([2, 1], 2), "both rounds");
  assert.equal(describeRounds([1, 2, 4], 5), "rounds 1, 2 & 4");
});

test("divergence: majority includes my vote, the AI is never counted, no invented majority", () => {
  assert.deepEqual(voteDivergence("HIRE", ["NO_HIRE", "NO_HIRE"], null), {
    ai: null,
    panel: { kind: "majority", vote: "NO_HIRE" },
  });
  assert.deepEqual(voteDivergence("HIRE", ["NO_HIRE"], "HIRE"), {
    ai: null,
    panel: { kind: "one", vote: "NO_HIRE" },
  });
  assert.deepEqual(voteDivergence("HIRE", ["NO_HIRE", "STRONG_NO_HIRE"], "NO_HIRE"), {
    ai: "NO_HIRE",
    panel: { kind: "split" },
  });
  assert.deepEqual(voteDivergence("HIRE", ["HIRE"], null), { ai: null, panel: null });
  assert.deepEqual(voteDivergence(null, ["HIRE"], "NO_HIRE"), { ai: null, panel: null });
});

test("calendar file: stable UID, escaped values, CR stripped, lines folded at 75 octets", () => {
  assert.equal(escapeIcs("a;b,c\r\nd\\"), "a\\;b\\,c\\nd\\\\");
  const long = "SUMMARY:" + "é".repeat(60);
  const folded = foldLine(long).split("\r\n");
  assert.ok(folded.every((l) => Buffer.byteLength(l) <= 75));
  assert.equal(
    folded.map((l, i) => (i ? l.slice(1) : l)).join(""),
    long,
    "unfolding restores the line",
  );
  const ics = buildIcs(
    [
      {
        id: "iv1",
        scheduledDate: new Date("2026-10-27T06:00:00Z"),
        round: "TECHNICAL",
        roundOrdinal: 2,
        candidateName: "Aisha\r\nATTENDEE:x",
        location: "Room 1",
        durationMinutes: 45,
      },
    ],
    new Date("2026-10-26T00:00:00Z"),
  );
  assert.match(ics, /UID:interview-iv1@hr-centre-hiring/);
  assert.match(ics, /DTEND:20261027T064500Z/);
  assert.doesNotMatch(ics, /\r\nATTENDEE/, "a value cannot inject a property");
});

test("boundary: notes-only autosave, revise needs reason and scores, decision note ≥ 20", () => {
  const notesOnly = panelScoreSchema.parse({ notes: "Strong on trade-offs" });
  assert.equal(
    notesOnly.scores,
    undefined,
    "a notes-only save carries no scores to overwrite the draft",
  );
  assert.equal(notesOnly.submit, false);
  assert.equal(panelScoreSchema.safeParse({ scores: { X: 6 } }).success, false);
  assert.equal(
    panelReviseSchema.safeParse({ vote: "HIRE", scores: {}, reason: "" }).success,
    false,
  );
  assert.equal(
    panelReviseSchema.parse({ vote: "HIRE", reason: "New evidence" }).scores instanceof Object,
    true,
  );
  assert.equal(
    comparisonActionSchema.safeParse({
      action: "select-preferred",
      candidateId: "c1",
      note: "too short",
    }).success,
    false,
  );
  assert.equal(
    createInterviewSchema.safeParse({
      candidateId: "c1",
      round: "TECHNICAL",
      scheduledDate: "2026-10-27T06:00:00Z",
      panelistIds: [],
    }).success,
    false,
  );
  assert.equal(
    roundPlanSchema.safeParse({
      rounds: [
        { round: "TECHNICAL", durationMinutes: 60 },
        { round: "TECHNICAL", durationMinutes: 45 },
      ],
    }).success,
    false,
    "a round kind appears once in a plan",
  );
});

function routes(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) routes(p, out);
    else if (e === "route.ts") out.push(p);
  }
  return out;
}

test("route floor: every slice-4 handler is rate-limited, authenticated and scope-resolved", () => {
  const files = [
    ...routes("app/api/hiring/interviews"),
    ...routes("app/api/hiring/panel"),
    ...routes("app/api/hiring/evaluations"),
    "app/api/hiring/requisitions/[id]/interviews/route.ts",
    "app/api/hiring/requisitions/[id]/comparison/route.ts",
  ];
  assert.ok(files.length >= 17);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const handlers = src.match(/export const (GET|POST|PUT|PATCH|DELETE) = /g) ?? [];
    assert.ok(handlers.length > 0, f);
    const wrapped = src.match(/withRateLimit\(\s*withAuth\(\s*hiringRoute\(/g) ?? [];
    assert.equal(
      wrapped.length,
      handlers.length,
      `${f}: every handler is withRateLimit(withAuth(hiringRoute(…)))`,
    );
  }
});

test("panel: every per-interview panel route loads the interview only for a panelist ON it", () => {
  for (const f of routes("app/api/hiring/panel").filter((p) => p.includes("[id]"))) {
    const src = readFileSync(f, "utf8");
    const handlers = (src.match(/export const (GET|POST|PUT|PATCH|DELETE) = /g) ?? []).length;
    const guarded = (src.match(/await loadMyInterview\(actor, id\)/g) ?? []).length;
    assert.equal(guarded, handlers, `${f}: each handler calls loadMyInterview`);
  }
});

test("D7: the panel brief never selects nationality, contact details or the raw profile", () => {
  const src = readFileSync("lib/hiring/panel.ts", "utf8");
  const brief = src.slice(
    src.indexOf("export async function brief"),
    src.indexOf("function sanitizeExperience"),
  );
  for (const field of [
    "nationality",
    "email",
    "phone",
    "nationalId",
    "salaryExpectation",
    "aiScore",
  ]) {
    assert.doesNotMatch(brief, new RegExp(`\\b${field}\\b`), `brief must not read ${field}`);
  }
  assert.doesNotMatch(brief, /profile: /, "no raw profile in the payload");
});

test("decision: selection checks the gate BEFORE marking anyone preferred", () => {
  const src = readFileSync("lib/hiring/comparison.ts", "utf8");
  const fn = src.slice(
    src.indexOf("export async function selectPreferred"),
    src.indexOf("export async function rejectFinalist"),
  );
  assert.ok(fn.indexOf("mayCrossGates") > 0);
  assert.ok(fn.indexOf("mayCrossGates") < fn.indexOf("preferredAt: new Date()"));
});

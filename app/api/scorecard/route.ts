import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/core/actor";
import { displayScore } from "@/lib/pms/scoring";
import { consolidateThreeSixty } from "@/lib/pms/three-sixty";

/**
 * §13.1 — the employee scorecard.
 *
 * "Shows only: final band and score (calibrated, but never labeled as such —
 * just 'their score') + consolidated 360 score and combined/summarized written
 * comments (not attributed to individual raters, protecting anonymity).
 *
 * The employee never sees: raw scores, component breakdown, any sign of
 * calibration, or mid-process work."
 *
 * That last sentence is a list of things this route must NOT return, and it is
 * honoured by construction rather than by filtering: the select never reads
 * `rawScore`, `rawBand`, or any component column, so no code path here could
 * return them even by mistake.
 *
 * ## "Their score", not "their calibrated score"
 *
 * The band returned IS `calibratedBand`, and the field is named `band`. §13.1 is
 * explicit that the employee sees no "sign of calibration" — so the payload
 * carries no adjustment history, no raw comparison, and no field name that would
 * tell them a curve exists at all.
 */

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const url = new URL(request.url);
    const cycleId = url.searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");

    // Whose scorecard. An employee reads their own; HR and the executive viewers
    // read anyone's (§4.1's org-wide sight, §13.6's drill-down).
    const requested = url.searchParams.get("employeeId");
    const employeeId = requested ?? actor.employeeId;
    if (!employeeId) return err("This account has no linked employee record (ADR-065).", 403);

    const isSelf = employeeId === actor.employeeId;
    if (!isSelf && !actor.capabilities.orgWide) {
      // A line manager does NOT get their report's scorecard: §13.3 gives the
      // manager workspace "status, scores, and bands", which is the roster, and
      // §13.1's scorecard is the employee's own view of their own year.
      return err("A scorecard is the employee's own.", 403);
    }

    const publication = await prisma.cyclePublication.findUnique({
      where: { cycleId },
      select: { published: true, publishedAt: true },
    });

    // §13.2 — "Nothing shows to the employee while work is happening in the
    // background (no partial/shifting results)." HR may look before publication;
    // the employee gets a truthful "not yet" rather than a 403 that would imply
    // something is being withheld from them specifically.
    if (!publication?.published && !actor.capabilities.orgWide) {
      return ok({ published: false, cycleId });
    }

    const runs = await prisma.scoreRun.findMany({
      where: { cycleId },
      take: 1,
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
    if (runs.length === 0) {
      return ok({ published: publication?.published ?? false, cycleId, score: null });
    }

    const score = await prisma.employeeScore.findUnique({
      where: { scoreRunId_employeeId: { scoreRunId: runs[0].id, employeeId } },
      // NOTE what is absent: rawBand and every component column. §13.1 — "The
      // employee never sees: raw scores, component breakdown, any sign of
      // calibration." `rawScore` IS read, but only as the input to
      // `displayScore`, which clamps it into the band the employee was placed
      // in; the raw figure itself never reaches the payload. See the note on
      // `displayScore` for why showing it unclamped would BE the sign of
      // calibration §13.1 forbids.
      select: {
        calibratedBand: true,
        rawScore: true,
        employee: { select: { id: true, name: true } },
      },
    });
    if (!score) {
      const exists = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true },
      });
      if (!exists) return notFound("Employee");
      return ok({ published: true, cycleId, score: null });
    }

    // §13.1's 360 half: the consolidated score and the combined comments.
    // The consolidation itself lives in lib/pms/three-sixty.ts — the anonymity
    // rule ("not attributed to individual raters") is a property of the shape it
    // returns, and this route only decides WHICH forms feed it.
    const threeSixty = await prisma.threeSixtyCycle.findUnique({
      where: { cycleId },
      select: { id: true },
    });
    const submitted = threeSixty
      ? await prisma.assignment.findMany({
          where: { threeSixtyCycleId: threeSixty.id, rateeId: employeeId, status: "SUBMITTED" },
          take: 10,
          select: {
            responses: { select: { score: true, text: true, questionId: true }, take: 60 },
            template: { select: { questions: { select: { id: true, scored: true }, take: 60 } } },
          },
        })
      : [];
    const consolidated = consolidateThreeSixty(
      submitted.map((a) => ({ responses: a.responses, questions: a.template.questions })),
    );

    return ok({
      published: true,
      cycleId,
      publishedAt: publication?.publishedAt ?? null,
      score: {
        employeeId: score.employee.id,
        name: score.employee.name,
        // "just 'their score'" — no adjective, no companion raw figure.
        band: score.calibratedBand,
        score: displayScore(score.rawScore, score.calibratedBand).toFixed(2),
        threeSixty: consolidated.level ? consolidated.level.toFixed(2) : null,
        comments: consolidated.comments,
        // §13.1's anonymity floor (R3). The flag, not an empty list: "nobody
        // wrote anything" and "too few people answered to share what they wrote"
        // are different facts, and the screen says which one this is.
        commentsWithheld: consolidated.commentsWithheld,
      },
    });
  }),
  { id: "pms-scorecard", limit: 120, windowMs: 60_000 },
);

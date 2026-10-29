import { notFound } from "next/navigation";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { requireSession } from "./page-gate";

/**
 * RECORD gates for detail screens (docs/blueprints/limits.md slice 3, ADR-101):
 * a record that does not exist — or is outside what the viewer may open — is a
 * real HTTP 404, decided on the server by the module's OWN loader (the one its
 * read route uses), before the page streams. Before this the client fetched,
 * got a 404 and drew "Not found" inside a 200.
 *
 * Module code is imported lazily so a page pulls in only its own module.
 */

type Opens = (session: Session, id: string) => Promise<boolean>;

const hiringActor = async (session: Session) =>
  (await import("@/lib/hiring/actor")).resolveHiringActor(session);

const jmlActorOf = async (session: Session) => (await import("@/lib/jml/access")).jmlActor(session);

/** A loader that throws (404/403) for "cannot open" answers false. */
const quietly = async (p: Promise<unknown>) => {
  try {
    return Boolean(await p);
  } catch {
    return false;
  }
};

const RECORDS = {
  "hiring.requisition": async (s, id) => {
    const { loadRequisition } = await import("@/lib/hiring/requisitions");
    return (await loadRequisition(await hiringActor(s), id)) !== null;
  },
  "hiring.candidate": async (s, id) => {
    const { loadCandidate } = await import("@/lib/hiring/candidates");
    return (await loadCandidate(await hiringActor(s), id)) !== null;
  },
  "hiring.offer": async (s, id) => {
    const { loadOffer } = await import("@/lib/hiring/offers");
    return (await loadOffer(await hiringActor(s), id)) !== null;
  },
  "hiring.interview": async (s, id) => {
    const { loadInterview } = await import("@/lib/hiring/interviews");
    return (await loadInterview(await hiringActor(s), id)) !== null;
  },
  "hiring.evaluation": async (s, id) => {
    const { loadEvaluation } = await import("@/lib/hiring/evaluations");
    return (await loadEvaluation(await hiringActor(s), id)) !== null;
  },
  "hiring.panel": async (s, id) => {
    const { loadMyInterview } = await import("@/lib/hiring/panel");
    return quietly(loadMyInterview(await hiringActor(s), id));
  },
  "jml.case": async (s, id) => {
    const { loadCaseFor } = await import("@/lib/jml/access");
    return quietly(loadCaseFor(await jmlActorOf(s), id, "jml.view"));
  },
  "jml.joiner": async (s, id) => {
    const { loadCaseFor } = await import("@/lib/jml/access");
    return quietly(loadCaseFor(await jmlActorOf(s), id, "jml.view", "JOIN"));
  },
  "jml.report": async (_s, slug) => (await import("@/lib/jml/reports/registry")).isReportSlug(slug),
  "jml.leaveReport": async (_s, slug) =>
    (await import("@/lib/jml/reports/leave/registry")).isLeaveReportSlug(slug),
  ticket: async (s, id) => {
    const { ticketReaderIds } = await import("@/lib/hive/services/permissions");
    return (await ticketReaderIds(id, [s.user.id])).has(s.user.id);
  },
  "pms.cycle": async (_s, id) =>
    (await prisma.performanceCycle.findUnique({ where: { id }, select: { id: true } })) !== null,
  // The 360 form belongs to exactly its rater (GET /api/three-sixty/responses).
  "pms.threeSixtyAssignment": async (s, id) => {
    const { resolveActor } = await import("@/lib/core/actor");
    const [actor, row] = await Promise.all([
      resolveActor(s),
      prisma.assignment.findUnique({ where: { id }, select: { raterId: true } }),
    ]);
    return row !== null && actor.employeeId !== null && row.raterId === actor.employeeId;
  },
  // A login on the access screen (the screen itself is section-gated).
  login: async (_s, id) =>
    (await prisma.user.findUnique({ where: { id }, select: { id: true } })) !== null,
} satisfies Record<string, Opens>;

export type RecordKind = keyof typeof RECORDS;

/**
 * Server gate for a detail screen: 404 unless the viewer may open record `id`.
 * Call it in a server page or layout with NO loading boundary above it.
 */
export async function requireRecord(kind: RecordKind, id: string): Promise<Session> {
  const session = await requireSession();
  const opens: Opens = RECORDS[kind];
  if (!(await opens(session, id).catch(() => false))) notFound();
  return session;
}

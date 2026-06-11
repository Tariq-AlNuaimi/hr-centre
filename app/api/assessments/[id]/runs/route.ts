import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withEditorAuth, withRateLimit } from "@/lib/api-helpers";
import { withAuditContext } from "@/lib/audit-context";
import { ok, created, notFound } from "@/lib/api-response";
import { executeRun } from "@/lib/testing/engine";

// A run does a browser capture + several model calls. We process it AFTER sending
// the response (Next's `after`) so the POST returns immediately and the client
// polls GET /api/runs/[id] for the result — no long-held request that the browser
// or gateway times out. maxDuration still bounds the background work (60s Hobby /
// 300s Pro); heavier runs want a durable job (Inngest) per ADR-016.
export const maxDuration = 300;

// List runs for an assessment (any authenticated user).
export const GET = withAuth(async (_request: NextRequest, { params }) => {
  const { id } = await params;
  const runs = await prisma.testRun.findMany({
    where: { assessmentId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      overallScore: true,
      summary: true,
      createdAt: true,
      finishedAt: true,
    },
  });
  return ok(runs);
});

// Start a run (ADMIN or EDITOR). Creates a PENDING run, kicks off processing in the
// background, and returns the run id immediately. Rate-limited — runs cost API +
// browser credits.
export const POST = withRateLimit(
  withEditorAuth(async (_request: NextRequest, { params, session }) => {
    const { id } = await params;
    const assessment = await prisma.assessment.findUnique({
      where: { id },
      include: { credentials: { orderBy: { order: "asc" } } },
    });
    if (!assessment) return notFound("Assessment");

    // Authenticated assessment with roles -> one run per role; otherwise one
    // anonymous run. (Multiple roles run concurrently in the background; on the free
    // plan only the first reliably fits the time limit — see ADR-016.)
    const roles: (string | null)[] =
      assessment.authMode !== "NONE" && assessment.credentials.length > 0
        ? assessment.credentials.map((c) => c.role)
        : [null];

    const userId = session.user.id;
    const runs: { id: string; status: string; role: string | null; createdAt: Date }[] = [];
    for (const role of roles) {
      const run = await prisma.testRun.create({
        data: { assessmentId: id, status: "PENDING", role },
        select: { id: true, status: true, role: true, createdAt: true },
      });
      runs.push(run);
      // Process after the response. executeRun is self-contained (records its own
      // FAILED); guard anyway so a stray rejection isn't unhandled.
      after(async () => {
        try {
          await withAuditContext({ userId }, () => executeRun(run.id));
        } catch {
          /* swallowed — the read-time reaper will catch a left-behind run */
        }
      });
    }

    // Return the first run for the client to poll; others appear in run history.
    return created({ ...runs[0], runs });
  }),
  { id: "assessment-run", limit: 10, windowMs: 60_000 }
);

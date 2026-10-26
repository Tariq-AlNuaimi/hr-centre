import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound } from "@/lib/api-response";
import { buildIcs, icsHeaders } from "@/lib/hiring/ics";
import { resolveBriefForRound } from "@/lib/hiring/interview-rules";
import { loadInterview, loadRoundPlan } from "@/lib/hiring/interviews";
import { hiringRoute } from "@/lib/hiring/route";

/** One interview's calendar invite. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadInterview(actor, id);
      if (!l) return notFound("Interview");
      const entry = resolveBriefForRound(await loadRoundPlan(l.iv.requisitionId), l.iv.round);
      const body = buildIcs([
        {
          id: l.iv.id,
          scheduledDate: l.iv.scheduledDate,
          round: l.iv.round,
          location: l.iv.location,
          meetingLink: l.iv.meetingLink,
          candidateName: l.iv.candidate.name,
          requisitionTitle: l.iv.requisition.title,
          durationMinutes: entry.durationMinutes,
          roundOrdinal: entry.ordinal,
        },
      ]);
      return new NextResponse(body, { headers: icsHeaders(`interview-${l.iv.id}.ics`) });
    }),
  ),
  { id: "hiring-interview-read", limit: 240, windowMs: 60_000 },
);

import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound } from "@/lib/api-response";
import { buildIcs, icsHeaders } from "@/lib/hiring/ics";
import { calendarRows } from "@/lib/hiring/interview-views";
import { loadRequisition } from "@/lib/hiring/requisitions";
import { hiringRoute, parseQuery } from "@/lib/hiring/route";
import { calendarQuerySchema } from "@/lib/validations/hiring/interview";

/** Every interview in scope as one .ics file (≤ 2,000), optionally one requisition's. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const q = parseQuery(req, calendarQuerySchema);
      if ("response" in q) return q.response;
      let title: string | null = null;
      if (q.data.requisitionId) {
        const l = await loadRequisition(actor, q.data.requisitionId);
        if (!l) return notFound("Requisition");
        title = l.req.title;
      }
      const rows = await calendarRows(actor, q.data);
      const body = buildIcs(
        rows.map((r) => ({
          id: r.id,
          scheduledDate: r.scheduledDate,
          round: r.round,
          location: r.location,
          meetingLink: r.meetingLink,
          candidateName: r.candidate.name,
          requisitionTitle: r.requisition.title,
          durationMinutes: r.roundMinutes,
          roundOrdinal: r.roundOrdinal,
        })),
      );
      return new NextResponse(body, {
        headers: icsHeaders(title ? `interviews-${title.toLowerCase()}.ics` : "interviews.ics"),
      });
    }),
  ),
  { id: "hiring-export", limit: 20, windowMs: 60_000 },
);

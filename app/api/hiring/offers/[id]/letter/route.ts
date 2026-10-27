import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound } from "@/lib/api-response";
import { renderOfferLetter } from "@/lib/hiring/offer-letter";
import { loadOffer, offerPay } from "@/lib/hiring/offers";
import { hiringRoute } from "@/lib/hiring/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The offer letter PDF. It carries the pay, so HR with comp access only. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadOffer(actor, id, "manage");
      if (!l || !l.comp) return notFound("Offer");
      const o = l.offer;
      const pay = offerPay(o);
      const pdf = await renderOfferLetter({
        candidateName: o.candidate.name,
        position: o.requisition.title,
        grade: o.requisition.grade,
        company: l.entity?.name ?? "Rihal",
        salary: pay.salary,
        allowances: pay.allowances,
        startDate: o.startDate,
        probationMonths: o.probationMonths,
        noticePeriod: o.noticePeriod,
        contractType: o.contractType,
        benefits: o.benefits,
        status: o.status,
      });
      const ascii =
        o.candidate.name
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-|-$/g, "")
          .toLowerCase() || "candidate";
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="offer-letter-${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(`offer-letter-${o.candidate.name}.pdf`)}`,
          "cache-control": "no-store",
        },
      });
    }),
  ),
  { id: "hiring-export", limit: 20, windowMs: 60_000 },
);

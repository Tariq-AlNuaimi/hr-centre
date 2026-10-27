import type { NextRequest } from "next/server";
import { withRateLimit } from "@/lib/api-helpers";
import { created, err } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { submitViaInvite } from "@/lib/hiring/agency-invites";
import { hiringErrorResponse } from "@/lib/hiring/http";
import { agencySubmitSchema, inviteTokenSchema } from "@/lib/validations/hiring/public";

/**
 * PUBLIC BY DESIGN — an agency submits a candidate through its invite link
 * (Interview Hub `POST /agency/[token]/submit`). The TOKEN is the
 * authorisation, for one invite: 256-bit, only its hash stored, expiring,
 * revocable, capped. Every invalid token answers the same 404. Limited per IP
 * and per token. Consent is enforced (D2); the agency name comes from the
 * invite, never the form; the CV must BE a PDF (bytes sniffed).
 */

const NOT_VALID = "This submission link is not valid.";

function tokenScopedRequest(token: string): Request {
  const headers = new Headers();
  const trusted = process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  if (trusted) headers.set(trusted, token);
  headers.set("x-real-ip", token);
  headers.set("x-forwarded-for", token);
  return new Request("https://hiring.internal/agency", { headers });
}

function noStore<T extends Response>(res: T): T {
  res.headers.set("Cache-Control", "no-store, private");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

async function submit(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  const token = inviteTokenSchema.safeParse((await ctx.params).token);
  if (!token.success) return noStore(err(NOT_VALID, 404));
  const limit = await rateLimit(tokenScopedRequest(token.data), {
    id: "agency-submit-token",
    limit: 10,
    windowMs: 60_000,
  });
  if (!limit.ok) return noStore(err("Too many requests", 429));
  const form = await req.formData().catch(() => null);
  if (!form) return noStore(err("Check the form and try again.", 400));
  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const parsed = agencySubmitSchema.safeParse({
    candidateName: field("candidateName") ?? "",
    candidateEmail: field("candidateEmail") ?? "",
    currentEmployer: field("currentEmployer") ?? "",
    salaryExpectation: field("salaryExpectation") ?? "",
    fitNote: field("fitNote") ?? "",
    consent: field("consent"),
  });
  if (!parsed.success)
    return noStore(err(parsed.error.issues[0]?.message ?? "Check the form and try again.", 400));
  const file = form.get("cv");
  if (!(file instanceof File)) return noStore(err("Attach the candidate's CV as a PDF.", 400));
  try {
    return noStore(created(await submitViaInvite(token.data, parsed.data, file)));
  } catch (e) {
    return noStore(hiringErrorResponse(e));
  }
}

export const POST = withRateLimit(submit, { id: "agency-submit", limit: 5, windowMs: 60_000 });

import type { NextResponse } from "next/server";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { withRateLimit } from "@/lib/api-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { resolveReplyToken } from "@/lib/hive/reply-token";
import { appendReply } from "@/lib/hive/services/reply";
import { replyBodySchema, replyTokenSchema } from "@/lib/validations/hive/reply";

/**
 * PUBLIC BY DESIGN — ADR-070's reply link, WRITE side only (AC-9.5, task 5.3b).
 *
 * There is no GET here, and its absence is deliberate. The blueprint's route
 * table named one, but the thread is rendered by a SERVER component that
 * resolves the token itself (`app/[locale]/(hive)/reply/[token]/page.tsx`), so a
 * JSON copy of the same Confidential data on a public endpoint would be surface
 * with no reader — kept only because a table said so. One route, one purpose.
 *
 * ADR-068's seventh and last enumerated public route, pre-approved with the
 * sixth when OQ-12 was raised: "ADR-070's reply link needs two public routes
 * beyond the five OQ-1 approved; the operator approved them on OQ-1's terms —
 * named allowlist entries, never a wildcard."
 *
 * **The token is the authorisation, and it authorises ONE thread.** ADR-070
 * clause 1: it does not grant the topic menu as that person, does not reach any
 * other escalation, and does not restore general chat history. Nothing here
 * mints a session, and the service it calls takes an escalation id that came
 * from the token rather than from the request.
 *
 * **Every failure is the same 404.** ADR-070 clause 6: malformed, unknown,
 * expired and revoked are four different facts, and telling them apart is an
 * oracle — "this token existed but expired" confirms a real escalation to
 * whoever is guessing. `resolveReplyToken` returns one value for all four, so
 * this route cannot leak the distinction even by accident.
 *
 * `noindex` and `no-store` because the body is Confidential (§1): a name, a work
 * email, a question and HR's approved answer.
 */

/**
 * ADR-070 clause 5: per TOKEN as well as per IP. Follow-ups per token per
 * minute — a person writes one, a script writes many.
 */
const WRITE_LIMIT = 5;
/**
 * A whole office shares this, so it is the backstop and never the primary
 * control: ~300 employees behind one egress address means a tight per-IP number
 * throttles the company rather than an abuser (ADR-068).
 */
const PER_IP_LIMIT = 120;
const WINDOW_MS = 60_000;

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, private",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

function withPrivateHeaders<T>(res: NextResponse<T>): NextResponse<T> {
  for (const [k, v] of Object.entries(PRIVATE_HEADERS)) res.headers.set(k, v);
  return res;
}

/**
 * A request whose only identity is the TOKEN, so `rateLimit`'s own per-IP bucket
 * lands per token too. Same shape as `lib/hive/session-scope.ts` and for the
 * same reason: one `rateLimit` call cannot express two different numbers.
 */
function tokenScopedRequest(token: string): Request {
  const headers = new Headers();
  const trusted = process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  if (trusted) headers.set(trusted, token);
  headers.set("x-real-ip", token);
  headers.set("x-forwarded-for", token);
  return new Request("https://hive.internal/reply", { headers });
}

async function postReply(req: Request, ctx: { params: Promise<Record<string, string>> }) {
  const raw = replyTokenSchema.safeParse((await ctx.params).token);
  if (!raw.success) return withPrivateHeaders(err("Not found.", 404));

  const limit = await rateLimit(tokenScopedRequest(raw.data), {
    id: "hive-reply-write",
    limit: WRITE_LIMIT,
    windowMs: WINDOW_MS,
  });
  if (!limit.ok) return withPrivateHeaders(err("Too many requests", 429));

  const parsed = replyBodySchema.safeParse(await readJsonBody(req));
  // Parsed AFTER the token is shape-checked and throttled, but BEFORE it is
  // resolved: a malformed body should not spend a database lookup, and the 400
  // it earns is not conditional on whether the escalation exists.
  if (!parsed.success) {
    return withPrivateHeaders(err(parsed.error.issues[0]?.message ?? "Invalid message.", 400));
  }

  const grant = await resolveReplyToken(raw.data);
  if (!grant) return withPrivateHeaders(err("Not found.", 404));

  const result = await appendReply(grant.escalationId, parsed.data.body);
  if ("error" in result) return withPrivateHeaders(err("Not found.", 404));
  return withPrivateHeaders(ok(result));
}

export const POST = withRateLimit(postReply, {
  id: "hive-reply-write-ip",
  limit: PER_IP_LIMIT,
  windowMs: WINDOW_MS,
});

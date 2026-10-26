import type { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import type { z } from "zod";
import { err, readJsonBody } from "@/lib/api-response";
import { validationError } from "@/lib/org/http";
import type { HiringActor } from "./access";
import { resolveHiringActor } from "./actor";
import { hiringErrorResponse } from "./http";

/**
 * The shape every hiring route shares: `withAuth` (outside) supplies the
 * session; this resolves the hiring actor once and turns a thrown hiring rule
 * into its status. Compose as `withRateLimit(withAuth(hiringRoute(fn)), …)`.
 */
type Ctx = { params: Promise<Record<string, string>>; session: Session };
type Handler = (req: NextRequest, ctx: Ctx & { actor: HiringActor }) => Promise<NextResponse>;

export function hiringRoute(handler: Handler) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    try {
      const actor = await resolveHiringActor(ctx.session);
      return await handler(req, { ...ctx, actor });
    } catch (e) {
      return hiringErrorResponse(e);
    }
  };
}

/** Parse a JSON body against a schema: `{ data }` or a ready 400 response. */
export async function parseBody<S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S,
): Promise<{ data: z.infer<S> } | { response: NextResponse }> {
  const body = await readJsonBody(req);
  if (body === null) return { response: err("Request body must be valid JSON") };
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { response: validationError(parsed.error) };
  return { data: parsed.data };
}

/** Parse query params against a schema (empty strings dropped). */
export function parseQuery<S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S,
): { data: z.infer<S> } | { response: NextResponse } {
  const raw: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    if (v !== "") raw[k] = v;
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { response: validationError(parsed.error) };
  return { data: parsed.data };
}

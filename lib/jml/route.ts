import type { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import type { z } from "zod";
import { readJsonBody } from "@/lib/api-response";
import type { Permission } from "@/lib/rbac/catalogue";
import { holdsAnywhere, holdsGroup, jmlActor, type JmlActor } from "./access";
import { JmlError, ValidationFailure, jmlErrorResponse } from "./errors";

/**
 * The JML route adapter. Every JML route is still written
 * `withRateLimit(withAuth(jml(...)), …)` — the auth wrapper stays literal in the
 * route file where `no-bare-api-route` checks it — and this resolves the actor
 * once, awaits params, and turns service refusals into their status + sentence.
 */

type Ctx = {
  req: NextRequest;
  params: Record<string, string>;
  session: Session;
  actor: JmlActor;
};

export function jml(handler: (ctx: Ctx) => Promise<NextResponse>) {
  return async (
    req: NextRequest,
    ctx: { params: Promise<Record<string, string>>; session: Session },
  ): Promise<NextResponse> => {
    try {
      const actor = await jmlActor(ctx.session);
      return await handler({ req, params: await ctx.params, session: ctx.session, actor });
    } catch (e) {
      return jmlErrorResponse(e);
    }
  };
}

/** Parse a JSON body with a schema, or throw the 422 sentence. */
export async function body<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  const raw = await readJsonBody(req);
  if (raw === null) throw new JmlError("Request body must be valid JSON", 400);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ValidationFailure(parsed.error);
  return parsed.data;
}

/** Parse query parameters with a schema, or throw the 422 sentence. */
export function query<S extends z.ZodType>(req: NextRequest, schema: S): z.infer<S> {
  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ValidationFailure(parsed.error);
  return parsed.data;
}

/** Require a permission held anywhere (list screens; rows are then scope-filtered). */
export function requireAnywhere(actor: JmlActor, permission: Permission): void {
  if (!holdsAnywhere(actor, permission)) {
    throw new JmlError("You do not have permission to do that.", 403);
  }
}

/** Require an org-wide (Group) permission — configuration. */
export function requireGroup(actor: JmlActor, permission: Permission): void {
  if (!holdsGroup(actor, permission)) {
    throw new JmlError(
      "Only someone holding this permission for the whole group can do that.",
      403,
    );
  }
}

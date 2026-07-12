import { NextRequest, NextResponse } from "next/server";
import { createFromSource } from "fumadocs-core/search/server";
import { z } from "zod";
import { withAuth } from "@/lib/api-helpers";
import { err } from "@/lib/api-response";
import { source } from "@/lib/docs/source";

// GET /api/docs-search — static Orama search over the docs source (ADR-053,
// AC-1.2; no external search SaaS). Internal-only like the docs pages
// themselves: session-gated with the standard wrapper (hard rule — auth
// wrapper on every route). A public-docs fork swaps `withAuth` for a bare
// handler alongside the middleware publicPaths change.
const { GET: search } = createFromSource(source, { language: "english" });

// zod at the boundary (hard rule): the only input is the `query` string.
const querySchema = z.object({ query: z.string().max(200).optional() });

export const GET = withAuth(async (req: NextRequest) => {
  const parsed = querySchema.safeParse({
    query: req.nextUrl.searchParams.get("query") ?? undefined,
  });
  if (!parsed.success) return err("Invalid search query", 400);
  const res = await search(req);
  // Re-wrap: the auth wrapper's handler contract returns NextResponse.
  return new NextResponse(res.body, { status: res.status, headers: res.headers });
});

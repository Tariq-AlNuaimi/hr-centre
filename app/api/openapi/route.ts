import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-helpers";
import { buildOpenApiDocumentSafe } from "@/lib/openapi";

// GET /api/openapi -- the machine-readable OpenAPI 3.1 contract for the /api/v1
// seam (ADR-013, ADR-052).
//
// Internal-gated (ADR-052 decision 1): wrapped in `withAuth` so only an
// authenticated session can read it -- no unauthenticated exposure of internal
// route shapes (US2-worst). The document describes schema SHAPES only, never
// Restricted data VALUES (SECURITY.md).
//
// The document is generated from the registered zod schemas in memory (no data
// round-trip). `private` caching lets the browser reuse it within the window
// without a shared cache serving one session's response to another.
export const GET = withAuth(async () => {
  const document = buildOpenApiDocumentSafe();
  return NextResponse.json(document, {
    status: 200,
    headers: { "cache-control": "private, max-age=300" },
  });
});

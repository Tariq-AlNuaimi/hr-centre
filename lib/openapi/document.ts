import { createDocument } from "zod-openapi";
import { BEARER_SCHEME_NAME, buildPaths, registeredRoutes, type RegisteredRoute } from "./registry";

// Builds the OpenAPI 3.1 document from the registered `/api/v1` routes (ADR-052).
// Pure -- NO I/O, NO data access. It reads the zod already written under
// lib/validations/ (via the registry) and emits a machine-readable contract.
//
// SECURITY: the document describes schema SHAPES only, never Restricted VALUES.
// No response example embeds real data (SECURITY.md; blueprint invariant).

/**
 * Build the OpenAPI 3.1 document. Defaults to the shipped `registeredRoutes`;
 * accepts an explicit list so callers/tests can build a document over an
 * arbitrary (including empty) registration set.
 *
 * The security scheme is the `withApiAuth` Bearer seam (ADR-013): a machine
 * consumer presents `Authorization: Bearer <token>`.
 */
export function buildOpenApiDocument(routes: readonly RegisteredRoute[] = registeredRoutes) {
  return createDocument({
    openapi: "3.1.0",
    info: {
      title: "API",
      version: "1.0.0",
      description:
        "Machine-readable contract for the versioned /api/v1 seam, generated from " +
        "the lib/validations zod schemas (ADR-013, ADR-052). Describes request/response " +
        "shapes only -- never Restricted data values.",
    },
    // Relative server so the spec is correct on any deployment (preview/prod)
    // without hardcoding a host; consumers resolve against the origin they fetch
    // the spec from.
    servers: [{ url: "/", description: "This deployment" }],
    components: {
      securitySchemes: {
        [BEARER_SCHEME_NAME]: {
          type: "http",
          scheme: "bearer",
          description:
            "Machine-consumer Bearer token -- the withApiAuth seam (ADR-013). " +
            "Present as `Authorization: Bearer <token>`.",
        },
      },
    },
    security: [{ [BEARER_SCHEME_NAME]: [] }],
    paths: buildPaths(routes),
  });
}

/**
 * Build the document, degrading to a valid, path-less 3.1 document rather than
 * throwing if a registered schema cannot be represented in OpenAPI (US1-worst:
 * `/api/openapi` must never 500). With the shipped (empty) registry this path is
 * never exercised; it guards a fork that registers an exotic schema.
 */
export function buildOpenApiDocumentSafe(routes: readonly RegisteredRoute[] = registeredRoutes) {
  try {
    return buildOpenApiDocument(routes);
  } catch {
    return buildOpenApiDocument([]);
  }
}

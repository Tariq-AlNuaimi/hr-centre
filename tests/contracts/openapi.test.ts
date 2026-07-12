// Contract tests for the OpenAPI generation layer (lib/openapi, ADR-052).
//
// DB-free and session-free by construction: lib/openapi is a pure layer over the
// zod schemas (no auth, no Prisma), so this imports it statically with no mocks.
//
//   node --import tsx --test tests/contracts/openapi.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import * as z from "zod/v4";
import {
  BEARER_SCHEME_NAME,
  buildOpenApiDocument,
  buildOpenApiDocumentSafe,
  buildPaths,
  registeredRoutes,
  type RegisteredRoute,
} from "../../lib/openapi";

// --- AC-1.1: the builder emits a structurally valid OpenAPI 3.1 document ---

test("buildOpenApiDocument emits a valid OpenAPI 3.1 document", () => {
  const doc = buildOpenApiDocument() as {
    openapi: string;
    info?: { title?: string; version?: string };
    paths?: Record<string, unknown>;
  };
  assert.match(doc.openapi, /^3\.1\.\d+$/, "openapi field must be 3.1.x");
  assert.ok(doc.info, "has info");
  assert.equal(typeof doc.info?.title, "string");
  assert.equal(typeof doc.info?.version, "string");
  assert.equal(typeof doc.paths, "object", "has a paths object");
  assert.notEqual(doc.paths, null);
});

// --- US1-worst / AC-1.3: a zero-route registry degrades to a valid, path-less
// doc rather than throwing (never a 500) ---

test("a zero-route registry yields a valid doc with zero paths (no throw)", () => {
  let doc: { openapi: string; paths?: Record<string, unknown> } | undefined;
  assert.doesNotThrow(() => {
    doc = buildOpenApiDocument([]) as typeof doc;
  });
  assert.match(doc!.openapi, /^3\.1\.\d+$/);
  assert.deepEqual(doc!.paths, {}, "no registered route means no paths");
});

test("the shipped registry is empty, so the default document has zero paths", () => {
  assert.equal(registeredRoutes.length, 0, "template ships no /api/v1 route");
  const doc = buildOpenApiDocument() as { paths?: Record<string, unknown> };
  assert.deepEqual(doc.paths, {});
});

test("buildOpenApiDocumentSafe never throws and returns a valid 3.1 doc", () => {
  let doc: { openapi: string } | undefined;
  assert.doesNotThrow(() => {
    doc = buildOpenApiDocumentSafe() as typeof doc;
  });
  assert.match(doc!.openapi, /^3\.1\.\d+$/);
});

// --- AC-1.1 (security): the security scheme reflects the withApiAuth Bearer seam ---

test("the document declares the withApiAuth Bearer security scheme", () => {
  const doc = buildOpenApiDocument() as {
    components?: { securitySchemes?: Record<string, { type?: string; scheme?: string }> };
    security?: Array<Record<string, unknown>>;
  };
  const scheme = doc.components?.securitySchemes?.[BEARER_SCHEME_NAME];
  assert.ok(scheme, "bearer scheme is present");
  assert.equal(scheme?.type, "http");
  assert.equal(scheme?.scheme, "bearer");
  assert.ok(
    doc.security?.some((s) => BEARER_SCHEME_NAME in s),
    "top-level security requires the bearer scheme",
  );
});

// --- AC-1.3: a registered route is included; the mapping produces a valid path ---

test("a registered route maps to a Bearer-secured path with request + responses", () => {
  const route: RegisteredRoute = {
    method: "post",
    path: "/api/v1/things",
    operationId: "createThing",
    summary: "Create a thing",
    request: { body: z.object({ name: z.string().min(1) }) },
    responses: {
      "201": { description: "Created", schema: z.object({ id: z.string() }) },
      "400": { description: "Bad request" },
    },
  };

  const paths = buildPaths([route]) as Record<
    string,
    Record<
      string,
      { security?: unknown[]; requestBody?: unknown; responses: Record<string, unknown> }
    >
  >;
  const op = paths["/api/v1/things"]?.post;
  assert.ok(op, "the post operation is present at the registered path");
  assert.ok(op.security, "defaults to Bearer-secured (secured ?? true)");
  assert.ok(op.requestBody, "carries the request body schema");
  assert.ok(op.responses["201"], "carries the 201 response");
  assert.ok(op.responses["400"], "carries the description-only 400 response");

  // The full document builds cleanly with the route registered (no throw).
  const doc = buildOpenApiDocument([route]) as { paths?: Record<string, unknown> };
  assert.ok(doc.paths?.["/api/v1/things"], "the registered route appears in the document");
});

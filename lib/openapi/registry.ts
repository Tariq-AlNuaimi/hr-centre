import * as z from "zod/v4";
import type { ZodOpenApiOperationObject, ZodOpenApiPathsObject } from "zod-openapi";

// The OpenAPI registry for the /api/v1 machine-consumer seam (ADR-013, ADR-052).
//
// Pure data over the existing lib/validations/ zod schemas -- NO I/O, NO data
// access. A registered route contributes its request/response zod (annotate the
// schemas with zod-openapi `.meta()` for rich output; unannotated schemas still
// emit valid, terser spec). document.ts turns these registrations into the
// `paths` of the generated OpenAPI 3.1 document.

/** HTTP methods a route registration may declare. */
/** @public */
export type RegisteredMethod = "get" | "post" | "put" | "patch" | "delete";

/** One response entry: its description + an optional JSON-body zod schema. */
/** @public */
export interface RegisteredResponse {
  description: string;
  /** zod schema for the `application/json` body; omit for empty responses. */
  schema?: z.ZodType;
}

/**
 * A single `/api/v1` route's contract, expressed over the zod we already write.
 * Adding a route to the spec is one entry in `registeredRoutes` below.
 */
export interface RegisteredRoute {
  method: RegisteredMethod;
  /** Full path as served, e.g. `/api/v1/users`. */
  path: string;
  operationId?: string;
  summary?: string;
  /** zod for the request; each part maps to the matching OpenAPI location. */
  request?: {
    body?: z.ZodType;
    /** Object schema for query params (each key is one param). */
    query?: z.ZodObject;
    /** Object schema for path params (each key is one param). */
    params?: z.ZodObject;
  };
  /** Keyed by HTTP status code, e.g. `{ "200": { description, schema } }`. */
  responses: Record<string, RegisteredResponse>;
  /**
   * When true, the operation requires the Bearer seam (`withApiAuth`, ADR-013).
   * Defaults to true -- `/api/v1` routes are machine-consumer, Bearer-gated.
   */
  secured?: boolean;
}

/**
 * Registered `/api/v1` routes included in the OpenAPI document.
 *
 * EMPTY today: the template ships no `/api/v1` route, so the generated document
 * has zero paths (a valid, path-less OpenAPI 3.1 doc -- never an error). A fork
 * that exposes a `/api/v1` route adds ONE entry here to include it in the spec,
 * the Scalar docs, and the Schemathesis contract test.
 */
export const registeredRoutes: RegisteredRoute[] = [];

/** Name of the Bearer security scheme in the generated document. */
export const BEARER_SCHEME_NAME = "bearerAuth";

/**
 * Build the OpenAPI `paths` object from route registrations. Pure: a total
 * function over its input (an empty list yields `{}`), no I/O.
 */
export function buildPaths(routes: readonly RegisteredRoute[]): ZodOpenApiPathsObject {
  const paths: ZodOpenApiPathsObject = {};

  for (const route of routes) {
    const operation: ZodOpenApiOperationObject = {
      responses: {},
    };
    if (route.operationId) operation.operationId = route.operationId;
    if (route.summary) operation.summary = route.summary;

    // `/api/v1` routes are Bearer-gated by default (the withApiAuth seam).
    if (route.secured ?? true) {
      operation.security = [{ [BEARER_SCHEME_NAME]: [] }];
    }

    if (route.request?.query || route.request?.params) {
      operation.requestParams = {};
      if (route.request.query) operation.requestParams.query = route.request.query;
      if (route.request.params) operation.requestParams.path = route.request.params;
    }
    if (route.request?.body) {
      operation.requestBody = {
        content: { "application/json": { schema: route.request.body } },
      };
    }

    type ResponseObject = { description: string; content?: Record<string, { schema: z.ZodType }> };
    const responses: Record<string, ResponseObject> = {};
    for (const [status, res] of Object.entries(route.responses)) {
      responses[status] = res.schema
        ? { description: res.description, content: { "application/json": { schema: res.schema } } }
        : { description: res.description };
    }
    operation.responses = responses as ZodOpenApiOperationObject["responses"];

    paths[route.path] = { ...paths[route.path], [route.method]: operation };
  }

  return paths;
}

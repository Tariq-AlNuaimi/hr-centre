import { NextResponse } from "next/server";

/** @public */
export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data } satisfies ApiResponse<T>, { status });
}

export function created<T>(data: T) {
  return ok(data, 201);
}

export function err(error: string, status = 400) {
  return NextResponse.json({ error } satisfies ApiResponse, { status });
}

export function notFound(entity = "Resource") {
  return err(`${entity} not found`, 404);
}

export function forbidden(message = "Forbidden") {
  return err(message, 403);
}

/** @public */
export function unauthorized(message = "Unauthorized") {
  return err(message, 401);
}

/**
 * Parse a JSON request body, returning `null` when the body is absent or
 * malformed rather than throwing.
 *
 * `await request.json()` throws a SyntaxError on a malformed body, and an
 * unhandled throw inside a route handler surfaces as a **500**. That is the
 * wrong answer: a body the client failed to encode is the client's error (400),
 * not a server fault. Reporting it as 500 also pollutes error monitoring with
 * noise no operator can act on, and tells an integrator debugging their own
 * request that our service is broken.
 *
 * Usage:
 *   const body = await readJsonBody(request);
 *   if (body === null) return err("Request body must be valid JSON");
 */
export async function readJsonBody(request: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

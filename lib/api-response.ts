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

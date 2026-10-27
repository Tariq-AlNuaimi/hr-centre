import { NextResponse } from "next/server";
import { IdDocumentKeyError } from "@/lib/people/id-documents";
import { StorageNotConfiguredError } from "@/lib/storage";
import { HiringCompKeyError } from "./comp-crypto";

/**
 * A refusal a hiring rule makes, with the HTTP status and (optionally) the
 * machine code the UI branches on (e.g. GATE_CONFIRM_REQUIRED opens the
 * "skip a required step?" dialog). Thrown by services, translated once here.
 */
export class HiringRuleError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly code?: string,
  ) {
    super(message);
    this.name = "HiringRuleError";
  }
}

function hiringError(message: string, status: number, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

/** Translate a known refusal; rethrow anything else so it reaches the error boundary. */
export function hiringErrorResponse(e: unknown): NextResponse {
  if (e instanceof HiringRuleError) return hiringError(e.message, e.status, e.code);
  if (e instanceof HiringCompKeyError) return hiringError(e.message, 503, "COMP_KEY_MISSING");
  if (e instanceof IdDocumentKeyError) return hiringError(e.message, 503, "ID_KEY_MISSING");
  if (e instanceof StorageNotConfiguredError) {
    return hiringError(e.message, 503, "STORAGE_NOT_CONFIGURED");
  }
  if (isPrismaCode(e, "P2002")) {
    return hiringError("Someone else just made the same change. Refresh and try again.", 409);
  }
  if (isPrismaCode(e, "P2025")) {
    return hiringError("This record changed while you were working. Refresh and try again.", 409);
  }
  throw e;
}

function isPrismaCode(e: unknown, code: string): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === code;
}

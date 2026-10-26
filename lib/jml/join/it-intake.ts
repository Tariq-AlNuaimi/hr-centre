import { prisma } from "@/lib/prisma";
import { isRetryable, itIntakeConfig, itIntakeFallbackUrl } from "../desks";

/**
 * The IT Microsoft Form intake (Onboarding §11.2 row 2, gate G6) — ported, and
 * now actually called (8.4.5): after activation and from the case's "Submit to
 * IT" action. Off unless IT_INTAKE_URL AND IT_INTAKE_DESIGN_APPROVED=true.
 * Retries network/429/5xx up to three times with exponential backoff; the case
 * number is the idempotency key, so a retry cannot open two IT requests.
 * The outcome is recorded on the joiner, so HR sees whether IT has it.
 */

export type ItIntakeOutcome =
  | { status: "skipped"; reason: string }
  | { status: "submitted"; reference: string }
  | { status: "failed"; reason: string; retryable: boolean; fallbackUrl: string | null };

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
const TIMEOUT_MS = 10_000;

async function buildPayload(caseId: string) {
  const kase = await prisma.jmlCase.findUnique({
    where: { id: caseId },
    select: {
      caseRef: true,
      employee: {
        select: {
          name: true,
          jobTitle: true,
          entity: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
      joinDetail: {
        select: {
          plannedStartDate: true,
          actualStartDate: true,
          msAccountRequired: true,
          laptopRequired: true,
          accessCardRequired: true,
        },
      },
    },
  });
  if (!kase?.joinDetail) return null;
  const d = kase.joinDetail;
  const start = d.actualStartDate ?? d.plannedStartDate;
  return {
    caseNumber: kase.caseRef,
    fullName: kase.employee.name,
    jobTitle: kase.employee.jobTitle,
    companyName: kase.employee.entity.name,
    departmentName: kase.employee.department?.name ?? null,
    startDate: start ? start.toISOString().slice(0, 10) : null,
    msAccountRequired: d.msAccountRequired,
    laptopRequired: d.laptopRequired,
    accessCardRequired: d.accessCardRequired,
  };
}

async function attempt(url: string, token: string | null, payload: { caseNumber: string }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": payload.caseNumber,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function submitToIt(caseId: string): Promise<ItIntakeOutcome> {
  const config = itIntakeConfig();
  if (!config.enabled) return { status: "skipped", reason: config.reason };
  const payload = await buildPayload(caseId);
  if (!payload) return { status: "skipped", reason: "Case not found" };
  let reason = "unknown";
  let retryable = true;
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    try {
      const response = await attempt(config.url, config.token, payload);
      if (response.ok) {
        return {
          status: "submitted",
          reference: response.headers.get("x-request-id") ?? payload.caseNumber,
        };
      }
      retryable = isRetryable(response.status);
      reason = `IT intake responded ${response.status}`;
      if (!retryable) break;
    } catch (e) {
      retryable = true;
      reason = e instanceof Error ? e.message : String(e);
    }
    if (n < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * 2 ** (n - 1)));
    }
  }
  return { status: "failed", reason, retryable, fallbackUrl: itIntakeFallbackUrl() };
}

/** Submit and record the outcome on the joiner (skipped outcomes are not recorded). */
export async function submitAndRecord(caseId: string): Promise<ItIntakeOutcome> {
  const outcome = await submitToIt(caseId);
  if (outcome.status === "skipped") return outcome;
  await prisma.jmlJoinDetail.update({
    where: { caseId },
    data:
      outcome.status === "submitted"
        ? {
            itIntakeSubmittedAt: new Date(),
            itIntakeReference: outcome.reference,
            itIntakeError: null,
          }
        : { itIntakeError: outcome.reason.slice(0, 500) },
    select: { caseId: true },
  });
  return outcome;
}

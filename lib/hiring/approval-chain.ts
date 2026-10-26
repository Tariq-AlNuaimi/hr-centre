import type { HiringApprovalRole } from "@/generated/prisma/client";
import { APPROVAL_ROLES } from "./access";

/**
 * Approval routing — pure core (Interview Hub `lib/services/approval-chain.ts`,
 * ADR-019/063 there). Returns the ordered approval ROLES for a requisition or an
 * offer; who holds each role is resolved separately (approval-config.ts).
 *
 *   step 2  (headcount + budget) — HR Manager, then Operations Director (fixed)
 *   step 10 (offer)              — HR Manager, then Operations Director: a FLOOR
 *                                  an admin may extend per company, never shorten;
 *                                  + COO when TOTAL monthly comp ≥ the threshold.
 *
 * Chains are keyed by the company CODE (RIHAL / TP / CL — Interview Hub's
 * RHL / TP / CL); an unknown code gets the floor.
 */

/** Default TOTAL monthly OMR at/above which an offer escalates to the COO. */
export const COO_THRESHOLD_OMR = 2500;

export type ChainKind = "offer" | "requisition";

export interface ChainStep {
  sequence: number;
  role: HiringApprovalRole;
}

export interface ChainOptions {
  /** Admin-configured offer chains per company code — may only ADD approvers. */
  overrides?: Record<string, HiringApprovalRole[] | undefined>;
  /** Admin-configured COO threshold (TOTAL monthly OMR). */
  threshold?: number;
  kind?: ChainKind;
}

const FLOOR: HiringApprovalRole[] = ["HR_MANAGER", "OPERATIONS_DIRECTOR"];

/** Override order kept, duplicates removed, missing floor roles appended. */
function mergeWithFloor(override: HiringApprovalRole[] | undefined): HiringApprovalRole[] {
  if (!override || override.length === 0) return [...FLOOR];
  const merged = override.filter((r, i) => override.indexOf(r) === i);
  for (const required of FLOOR) if (!merged.includes(required)) merged.push(required);
  return merged;
}

export function computeChain(
  entityCode: string | null | undefined,
  totalComp: number | null | undefined,
  opts: ChainOptions = {},
): ChainStep[] {
  const kind = opts.kind ?? "offer";
  const threshold = opts.threshold ?? COO_THRESHOLD_OMR;
  const roles =
    kind === "requisition" ? [...FLOOR] : mergeWithFloor(opts.overrides?.[entityCode ?? ""]);
  // COO escalation reads the PACKAGE, so it is an offer control only.
  if (kind === "offer" && escalatesToCoo(totalComp, threshold) && !roles.includes("COO")) {
    roles.push("COO");
  }
  return roles.map((role, i) => ({ sequence: i + 1, role }));
}

/**
 * TOTAL monthly comp: basic + every positive numeric allowance. The COO check
 * reads this, never basic alone — moving pay into allowances must not skip the
 * COO (Interview Hub red-team RT-14).
 */
export function totalMonthlyComp(
  salary: number | null | undefined,
  allowances?: unknown,
): number | null {
  const base = typeof salary === "number" && Number.isFinite(salary) ? salary : null;
  let extra = 0;
  if (allowances && typeof allowances === "object" && !Array.isArray(allowances)) {
    for (const v of Object.values(allowances as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) extra += v;
    }
  }
  if (base === null) return extra > 0 ? extra : null;
  return base + extra;
}

export function escalatesToCoo(
  totalComp: number | null | undefined,
  threshold: number = COO_THRESHOLD_OMR,
): boolean {
  return typeof totalComp === "number" && totalComp >= threshold;
}

/**
 * The chain an in-flight offer is judged against (its submit-time snapshot), or
 * null when the stored JSON is not a valid chain — config changes can never
 * rewrite an approval already under way.
 */
export function chainFromSnapshot(snapshot: unknown): ChainStep[] | null {
  if (!Array.isArray(snapshot) || snapshot.length === 0) return null;
  const steps: ChainStep[] = [];
  for (const raw of snapshot) {
    if (!raw || typeof raw !== "object") return null;
    const { sequence, role } = raw as Record<string, unknown>;
    if (typeof sequence !== "number" || typeof role !== "string") return null;
    if (!(APPROVAL_ROLES as readonly string[]).includes(role)) return null;
    steps.push({ sequence, role: role as HiringApprovalRole });
  }
  return steps;
}

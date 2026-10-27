import { z } from "zod";
import type { HiringApprovalRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { usersHoldingPermission } from "@/lib/rbac/resolve";
import type { ScopeSubject } from "@/lib/rbac/grants";
import { APPROVAL_ROLES, ROLE_PERMISSION } from "./access";
import {
  COO_THRESHOLD_OMR,
  computeChain,
  type ChainKind,
  type ChainOptions,
  type ChainStep,
} from "./approval-chain";
import { HiringRuleError } from "./http";
import { readSetting } from "./settings";

/**
 * Admin-configurable offer chains + COO threshold (`approvals.config`), and the
 * routing of each step to the people who hold its role for the record's scope
 * (`usersHoldingPermission`). Routing is ADVISORY display — whether someone may
 * actually sign is decided by `actsAs` in the approval route.
 */

export const approvalConfigSchema = z.object({
  chains: z.record(z.string().min(1).max(20), z.array(z.enum(APPROVAL_ROLES)).min(1).max(10)),
  cooThreshold: z.number().nonnegative().max(1_000_000),
});
export type ApprovalConfig = z.infer<typeof approvalConfigSchema>;

export async function loadApprovalConfig(): Promise<ApprovalConfig | null> {
  const parsed = approvalConfigSchema.safeParse(await readSetting("approvals.config"));
  return parsed.success ? parsed.data : null;
}

export function configToChainOptions(cfg: ApprovalConfig | null): ChainOptions {
  return cfg ? { overrides: cfg.chains, threshold: cfg.cooThreshold } : {};
}

export type Approver = { id: string; name: string; email: string };
export type RoutedStep = ChainStep & { approvers: Approver[] };

/** Resolve each step's role to its holders in this scope (name order). */
export async function routeChain(steps: ChainStep[], subject: ScopeSubject): Promise<RoutedStep[]> {
  const roles = [...new Set(steps.map((s) => s.role))];
  const holders = new Map<HiringApprovalRole, string[]>();
  for (const role of roles) {
    holders.set(role, await usersHoldingPermission(ROLE_PERMISSION[role], subject, { limit: 50 }));
  }
  const ids = [...new Set([...holders.values()].flat())];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
        take: 500,
      })
    : [];
  return steps.map((s) => {
    const allowed = new Set(holders.get(s.role) ?? []);
    return {
      ...s,
      approvers: users
        .filter((u) => allowed.has(u.id))
        .map((u) => ({ id: u.id, name: u.name ?? u.email, email: u.email })),
    };
  });
}

export async function getRoutedChain(
  entityCode: string,
  subject: ScopeSubject,
  totalComp: number | null | undefined,
  kind: ChainKind = "offer",
): Promise<{ steps: RoutedStep[]; threshold: number }> {
  const opts = { ...configToChainOptions(await loadApprovalConfig()), kind };
  const steps = computeChain(entityCode, totalComp, opts);
  return {
    steps: await routeChain(steps, subject),
    threshold: opts.threshold ?? COO_THRESHOLD_OMR,
  };
}

/** The roles-only chain stamped on an offer at submit (no comp in it). */
export async function computeChainSnapshot(
  entityCode: string,
  totalComp: number | null | undefined,
): Promise<ChainStep[]> {
  return computeChain(entityCode, totalComp, configToChainOptions(await loadApprovalConfig()));
}

/**
 * Chain roles that nobody holds for a company — the gap that made Interview
 * Hub's requisition gate unenforceable (D1). Shown in Hiring settings.
 */
export async function vacantApprovalRoles(
  companies: { id: string; code: string }[],
): Promise<{ code: string; role: HiringApprovalRole }[]> {
  const opts = configToChainOptions(await loadApprovalConfig());
  const out: { code: string; role: HiringApprovalRole }[] = [];
  for (const c of companies) {
    const required = new Set<HiringApprovalRole>();
    for (const kind of ["offer", "requisition"] as const) {
      for (const s of computeChain(c.code, Number.MAX_SAFE_INTEGER, { ...opts, kind })) {
        required.add(s.role);
      }
    }
    for (const role of required) {
      const holders = await usersHoldingPermission(
        ROLE_PERMISSION[role],
        { entityId: c.id },
        {
          limit: 1,
        },
      );
      if (holders.length === 0) out.push({ code: c.code, role });
    }
  }
  return out;
}

/** "OPERATIONS_DIRECTOR" → "Operations director"; acronyms stay as they are. */
export function approvalRoleLabel(role: HiringApprovalRole): string {
  if (role === "COO" || role === "CEO") return role;
  const words = role.toLowerCase().split("_");
  const label = words.join(" ").replace(/\bhr\b/, "HR");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Steps nobody could decide: no holder of the step's role in this scope, once
 * the people who may not decide it (the candidate's referrer, the submitter)
 * are left out. A record submitted with such a step waits forever and nobody
 * is told (UX review P0-1) — so submission refuses instead.
 */
export function vacantSteps(
  steps: readonly RoutedStep[],
  exclude: ReadonlyArray<string | null | undefined> = [],
): RoutedStep[] {
  const out = new Set(exclude.filter((x): x is string => Boolean(x)));
  return steps.filter((s) => !s.approvers.some((a) => !out.has(a.id)));
}

/** The refusal for a chain with a vacant step — names it and says where to fix it. */
export function assertChainStaffed(
  steps: readonly RoutedStep[],
  exclude: ReadonlyArray<string | null | undefined> = [],
): void {
  const vacant = vacantSteps(steps, exclude);
  if (vacant.length === 0) return;
  const roles = [...new Set(vacant.map((s) => approvalRoleLabel(s.role)))].join(", ");
  throw new HiringRuleError(
    `Nobody can approve the ${roles} step for this company yet, so it would wait with nobody to ` +
      `decide it. Ask a platform administrator to assign the role in Admin → Roles, then submit again.`,
    409,
    "VACANT_APPROVAL_STEP",
  );
}

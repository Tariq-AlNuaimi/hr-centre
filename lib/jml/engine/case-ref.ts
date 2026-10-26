import type { JmlCaseType } from "@/generated/prisma/client";
import type { auditedTransaction } from "@/lib/prisma";
import { CASE_REF_PREFIX } from "../vocab";

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

/**
 * `ONB-2026-0001` / `CHG-…` / `EXIT-…` — per prefix, per UTC year (Onboarding
 * `nextCaseNumber`, Offboarding `EXIT-{YYYY}-{NNNN}`): the highest existing + 1,
 * padded to 4. Immutable once issued.
 */
export async function nextCaseRef(
  tx: Tx,
  caseType: JmlCaseType,
  now = new Date(),
): Promise<string> {
  const prefix = `${CASE_REF_PREFIX[caseType]}-${now.getUTCFullYear()}-`;
  const rows = await tx.jmlCase.findMany({
    // Includes discarded drafts: a reference is never reused.
    where: { caseRef: { startsWith: prefix }, deletedAt: { not: undefined } },
    select: { caseRef: true },
    orderBy: { caseRef: "desc" },
    take: 1,
  });
  const last = rows[0] ? Number(rows[0].caseRef.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(last + 1).padStart(4, "0")}`;
}

function isCaseRefClash(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } };
  return err.code === "P2002" && JSON.stringify(err.meta?.target ?? "").includes("case_ref");
}

/**
 * Run a case-creating transaction, retrying when two creations raced for the
 * same reference (Onboarding 8.4.8: that race returned a 500).
 */
export async function withCaseRefRetry<T>(run: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (e) {
      if (i >= attempts || !isCaseRefClash(e)) throw e;
    }
  }
}

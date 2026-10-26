import type { JmlAccessDomain } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { JmlError } from "../errors";

/**
 * Leaver reference lists (Offboarding `/api/offboarding-admin/lists`): asset
 * types and the access-revocation checklist. Rows are deactivated, never
 * deleted — a case generated from them keeps its own copy.
 */

export function listAssetTypes() {
  return prisma.jmlAssetType.findMany({
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { id: true, label: true, active: true, sortOrder: true },
    take: 200,
  });
}

export async function saveAssetType(input: {
  id?: string;
  label: string;
  active: boolean;
  sortOrder: number;
}) {
  const clash = await prisma.jmlAssetType.findFirst({
    where: {
      label: { equals: input.label, mode: "insensitive" },
      ...(input.id ? { id: { not: input.id } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new JmlError(`An asset type called "${input.label}" already exists.`, 409);
  const data = { label: input.label, active: input.active, sortOrder: input.sortOrder };
  return auditedTransaction((tx) =>
    input.id
      ? tx.jmlAssetType.update({ where: { id: input.id }, data, select: { id: true } })
      : tx.jmlAssetType.create({ data, select: { id: true } }),
  );
}

export function listAccessChecklist() {
  return prisma.jmlAccessChecklistItem.findMany({
    orderBy: [{ domain: "asc" }, { sortOrder: "asc" }],
    select: {
      id: true,
      domain: true,
      label: true,
      sharedCredential: true,
      rotationRequired: true,
      active: true,
      sortOrder: true,
    },
    take: 300,
  });
}

export async function saveAccessChecklistItem(input: {
  id?: string;
  domain: JmlAccessDomain;
  label: string;
  sharedCredential: boolean;
  rotationRequired: boolean;
  active: boolean;
  sortOrder: number;
}) {
  const { id, ...rest } = input;
  const data = { ...rest, rotationRequired: rest.rotationRequired || rest.sharedCredential };
  return auditedTransaction((tx) =>
    id
      ? tx.jmlAccessChecklistItem.update({ where: { id }, data, select: { id: true } })
      : tx.jmlAccessChecklistItem.create({ data, select: { id: true } }),
  );
}

/** The exit-reason taxonomy (F9: the rows ARE the truth the interview validates against). */
export function listReasonCodes() {
  return prisma.leaveReasonCategory.findMany({
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      level1: true,
      label: true,
      active: true,
      codes: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, code: true, label: true, active: true, sortOrder: true },
      },
    },
    take: 20,
  });
}

/** Add a code, or relabel / (de)activate one. A code never moves category and is never deleted. */
export async function saveReasonCode(input: {
  id?: string;
  level1: string;
  code: string;
  label: string;
  active: boolean;
  sortOrder: number;
}) {
  const category = await prisma.leaveReasonCategory.findUnique({
    where: { level1: input.level1 as never },
    select: { id: true },
  });
  if (!category) throw new JmlError("Unknown reason category.", 422);
  if (input.id) {
    const existing = await prisma.leaveReasonCode.findUnique({
      where: { id: input.id },
      select: { code: true, categoryId: true },
    });
    if (!existing) throw new JmlError("Reason code not found", 404);
    if (existing.code !== input.code || existing.categoryId !== category.id) {
      throw new JmlError(
        "A reason code keeps its code and category — add a new code instead.",
        409,
      );
    }
    return auditedTransaction((tx) =>
      tx.leaveReasonCode.update({
        where: { id: input.id },
        data: { label: input.label, active: input.active, sortOrder: input.sortOrder },
        select: { id: true },
      }),
    );
  }
  const clash = await prisma.leaveReasonCode.findUnique({
    where: { code: input.code },
    select: { id: true },
  });
  if (clash) throw new JmlError(`${input.code} already exists.`, 409);
  return auditedTransaction((tx) =>
    tx.leaveReasonCode.create({
      data: {
        categoryId: category.id,
        code: input.code,
        label: input.label,
        active: input.active,
        sortOrder: input.sortOrder,
      },
      select: { id: true },
    }),
  );
}

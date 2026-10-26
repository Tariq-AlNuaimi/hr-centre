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

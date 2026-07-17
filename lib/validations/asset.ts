import { z } from "zod";
import { AssetStatus, AssetCategory } from "../../generated/prisma/client";

export const createAssetSchema = z.object({
  assetTag: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  serial: z.string().min(1).max(255).optional(),
  purchasedAt: z.coerce.date().optional(),
  status: z.nativeEnum(AssetStatus),
  category: z.nativeEnum(AssetCategory),
  assigneeId: z.string().min(1).optional(),
});

// assetTag is immutable after create (US1 invariant) — deliberately NOT updatable.
export const updateAssetSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  serial: z.string().min(1).max(255).optional(),
  purchasedAt: z.coerce.date().optional(),
  status: z.nativeEnum(AssetStatus).optional(),
  category: z.nativeEnum(AssetCategory).optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

// Status lifecycle (US4 / ADR-059) — the invariant the schema alone can't state.
// IN_STOCK↔ASSIGNED, IN_STOCK→REPAIR→IN_STOCK, any→RETIRED (terminal). A same-status
// no-op is always legal; RETIRED has no outgoing move.
const ASSET_STATUS_TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  [AssetStatus.IN_STOCK]: [AssetStatus.ASSIGNED, AssetStatus.REPAIR, AssetStatus.RETIRED],
  [AssetStatus.ASSIGNED]: [AssetStatus.IN_STOCK, AssetStatus.REPAIR, AssetStatus.RETIRED],
  [AssetStatus.REPAIR]: [AssetStatus.IN_STOCK, AssetStatus.RETIRED],
  [AssetStatus.RETIRED]: [],
};

/** Is moving an asset from `from` to `to` a legal lifecycle transition? (same status = no-op) */
export function isLegalStatusTransition(from: AssetStatus, to: AssetStatus): boolean {
  return from === to || ASSET_STATUS_TRANSITIONS[from].includes(to);
}

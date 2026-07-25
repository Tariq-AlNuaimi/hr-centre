// Human-readable labels for the Asset enums (V2-301 design-QA fix): the UI must not surface
// raw enum tokens like "IN_STOCK"/"LAPTOP". The DB/API keep the enum values; only the display
// is humanized. (A fuller pass migrates these into next-intl messages under V2-305 — copy
// chokepoint; a scaffold-emitted humanizer is logged as a follow-up in the findings register.)

const ASSET_STATUS_LABELS: Record<string, string> = {
  IN_STOCK: "In stock",
  ASSIGNED: "Assigned",
  REPAIR: "In repair",
  RETIRED: "Retired",
};

// NOTE: ASSET_CATEGORY_LABELS / assetCategoryLabel were removed with the `category` enum axis
// (OPEN-ITEMS item 7, 2026-07-25). Categories are now Category ENTITIES with operator-authored
// names, so there is nothing to humanize — the name renders as stored.

/** Display label for an enum value; falls back to the raw value if unmapped. */
export function assetStatusLabel(value: string): string {
  return ASSET_STATUS_LABELS[value] ?? value;
}

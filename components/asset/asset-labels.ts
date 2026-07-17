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

const ASSET_CATEGORY_LABELS: Record<string, string> = {
  LAPTOP: "Laptop",
  MONITOR: "Monitor",
  PHONE: "Phone",
  OTHER: "Other",
};

/** Display label for an enum value; falls back to the raw value if unmapped. */
export function assetStatusLabel(value: string): string {
  return ASSET_STATUS_LABELS[value] ?? value;
}
export function assetCategoryLabel(value: string): string {
  return ASSET_CATEGORY_LABELS[value] ?? value;
}

import type { Company, Directorate } from "./types";

/**
 * A department's place as one choice: "Codeline" (directly under the company)
 * or "Rihal / Technology" (under a directorate). Encoded as `entityId|dirId` so
 * a single select can move a department across both levels at once.
 */
export type PlacementOption = { value: string; label: string };

export function placementOptions(
  companies: Company[],
  directorates: Directorate[],
): PlacementOption[] {
  const out: PlacementOption[] = [];
  for (const company of companies) {
    out.push({ value: `${company.id}|`, label: company.name });
    for (const d of directorates.filter((x) => x.entityId === company.id)) {
      out.push({ value: `${company.id}|${d.id}`, label: `${company.name} / ${d.name}` });
    }
  }
  return out;
}

export function encodePlacement(entityId: string, directorateId: string | null): string {
  return `${entityId}|${directorateId ?? ""}`;
}

export function decodePlacement(value: string): { entityId: string; directorateId: string | null } {
  const [entityId, directorateId] = value.split("|");
  return { entityId, directorateId: directorateId || null };
}

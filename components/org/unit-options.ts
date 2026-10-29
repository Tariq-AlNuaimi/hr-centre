/**
 * QA D-17 — department (or directorate) filter options that tell apart units
 * sharing a name across companies: "Sales · Rihal", "Sales · Codeline". A name
 * that is unique in the list keeps its plain label.
 */
export function unitOptions(
  units: ReadonlyArray<{ id: string; name: string; entityId?: string | null }>,
  companyName: (entityId: string) => string | undefined,
): { value: string; label: string }[] {
  const counts = new Map<string, number>();
  for (const u of units) counts.set(u.name, (counts.get(u.name) ?? 0) + 1);
  return units.map((u) => {
    const company = u.entityId ? companyName(u.entityId) : undefined;
    const label = (counts.get(u.name) ?? 0) > 1 && company ? `${u.name} · ${company}` : u.name;
    return { value: u.id, label };
  });
}

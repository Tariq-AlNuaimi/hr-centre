import type { OrgChartEntity, OrgChartPerson } from "./org-chart";

/**
 * Finding one person in the chart — §4.2's tree, searched.
 *
 * Its own module for the reason `three-sixty-answer.ts` was split out of
 * `three-sixty.ts`: arranging the chart and finding somebody in it are
 * different jobs, and `org-chart.ts` crossed the complexity budget carrying
 * both. The seam is real rather than a gate dodge — the arrangement is pure
 * structure and runs once on the server's data, while this runs on every
 * keystroke and answers a different question.
 */

/**
 * Which people match a name search — and everyone on the path TO them.
 *
 * Returning the ancestors is the whole point: a match six levels down is
 * useless if its branch is collapsed, and auto-expanding to it is only possible
 * if the caller knows which rows are on the way. One pass, shared by the filter
 * and the expansion, so a row cannot be revealed without being kept, or kept
 * without being revealed.
 */
export function matchOrgChart(
  entities: OrgChartEntity[],
  query: string,
): { matched: Set<string>; onPath: Set<string> } {
  const matched = new Set<string>();
  const onPath = new Set<string>();
  const needle = query.trim().toLowerCase();
  if (needle === "") return { matched, onPath };

  function walk(person: OrgChartPerson, ancestors: string[]): boolean {
    const self = person.name.toLowerCase().includes(needle);
    if (self) matched.add(person.id);
    let below = false;
    for (const report of person.reports) {
      if (walk(report, [...ancestors, person.id])) below = true;
    }
    if (self || below) {
      for (const id of ancestors) onPath.add(id);
      if (below) onPath.add(person.id);
      return true;
    }
    return false;
  }

  for (const entity of entities) {
    for (const department of entity.departments) {
      for (const top of department.tops) {
        if (walk(top, [])) {
          onPath.add(entity.id);
          onPath.add(`${entity.id}::${department.id ?? ""}`);
        }
      }
    }
  }

  return { matched, onPath };
}

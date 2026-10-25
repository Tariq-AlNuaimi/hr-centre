/**
 * §4.2's reporting tree, arranged the way an org chart is actually read.
 *
 * ## What was wrong with the old shape
 *
 * The page rendered ONE recursive indented list of every visible person, rooted
 * at whoever had no visible manager, with the entity and department as a small
 * grey suffix on each row. At twenty people that is fine. At two hundred it is
 * a single unbroken column: nothing collapses, nothing can be searched, and the
 * two facts a reader navigates by — which entity, which department — are the
 * least prominent thing on the line.
 *
 * So the structure is inverted: entity, then department, then the reporting
 * line INSIDE that department. The reporting line is still the tree; it is just
 * no longer the only axis.
 *
 * ## Why departments nest reporting lines rather than flatten them
 *
 * A manager and their reports are not guaranteed to share a department — a
 * §12.1 roll-up moves a line across one, and §12.3's split-year transfer exists
 * precisely because people change department mid-cycle. Two honest options:
 * show a person under their manager (and lie about which department they are
 * in), or show them under their department (and lose the reporting line).
 *
 * This does neither. A person always appears under their OWN department, and a
 * line that crosses a boundary is named on the row (`reportsToName`) instead of
 * being silently dropped. The nesting inside a department is therefore the
 * same-department part of the reporting tree, which is what a department head
 * means by "my team".
 *
 * Pure and dependency-free so the arrangement can be tested without a database
 * or a browser — the tree-building bug this replaces (roots defined as "manager
 * not visible") was only ever covered by rendering it and looking.
 */

/** One visible person, as `ORG_TREE_NODE_SELECT` returns them. */
export type OrgNode = {
  id: string;
  name: string;
  roleTrack: string;
  status: string;
  managerId: string | null;
  department: { id: string; name: string } | null;
  entity: { id: string; code: string };
};

export type OrgChartPerson = {
  id: string;
  name: string;
  roleTrack: string;
  status: string;
  /** Same-department reports, nested. */
  reports: OrgChartPerson[];
  /**
   * Their manager's name, when that manager is visible but sits in a different
   * department — so a line leaving the group is stated rather than lost. Null
   * when the manager is in this department (the nesting already says it) or is
   * not visible at all (§4.2 scoping).
   */
  reportsToName: string | null;
  /** Everyone beneath them in this department, at any depth. */
  descendantCount: number;
};

export type OrgChartDepartment = {
  /** Null for the entity-level group — §1.2 makes that exactly the C-Level. */
  id: string | null;
  name: string | null;
  tops: OrgChartPerson[];
  /** People in this department, at any depth. */
  headcount: number;
};

export type OrgChartEntity = {
  id: string;
  code: string;
  /**
   * The C-Level group first (id `null`), then departments by name. First
   * because §1.2 ties C-Level to the entity directly, so they ARE the entity's
   * top line — not a leftover bucket.
   */
  departments: OrgChartDepartment[];
  headcount: number;
};

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/** The key a person is grouped under. `null` department is its own group. */
const deptKey = (node: OrgNode) => `${node.entity.id}::${node.department?.id ?? ""}`;

/**
 * Arrange visible people into entity → department → reporting line.
 *
 * Takes the already-scoped set: §4.2's visibility is decided before this is
 * called and is none of this function's business.
 */
export function buildOrgChart(nodes: OrgNode[]): OrgChartEntity[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Same-department reports, parent → children. A report whose manager is in a
  // DIFFERENT department is deliberately absent here: they are a top of their
  // own department instead, carrying the crossing on their row.
  const childrenOf = new Map<string, OrgNode[]>();
  const tops = new Map<string, OrgNode[]>();

  for (const node of nodes) {
    const manager = node.managerId ? byId.get(node.managerId) : undefined;
    const sameGroup = manager !== undefined && deptKey(manager) === deptKey(node);
    if (sameGroup) {
      const siblings = childrenOf.get(manager.id) ?? [];
      siblings.push(node);
      childrenOf.set(manager.id, siblings);
    } else {
      const group = tops.get(deptKey(node)) ?? [];
      group.push(node);
      tops.set(deptKey(node), group);
    }
  }

  /**
   * Depth-first, carrying the count back up.
   *
   * `seen` guards a cycle. The database has no constraint preventing A → B → A
   * (a manager edge is a plain self-relation), the import writes manager edges
   * from a spreadsheet, and an infinite recursion here would take out the whole
   * page rather than one row. A cycle shows as a truncated branch, which is
   * visible and wrong, rather than a blank screen, which is invisible and
   * wrong.
   */
  function toPerson(node: OrgNode, seen: Set<string>): OrgChartPerson {
    const manager = node.managerId ? byId.get(node.managerId) : undefined;
    const crosses = manager !== undefined && deptKey(manager) !== deptKey(node);

    const next = new Set(seen).add(node.id);
    const reports = (childrenOf.get(node.id) ?? [])
      .filter((child) => !next.has(child.id))
      .sort(byName)
      .map((child) => toPerson(child, next));

    return {
      id: node.id,
      name: node.name,
      roleTrack: node.roleTrack,
      status: node.status,
      reports,
      reportsToName: crosses ? manager.name : null,
      descendantCount: reports.reduce((sum, r) => sum + r.descendantCount + 1, 0),
    };
  }

  const entities = new Map<string, OrgChartEntity>();
  const departments = new Map<string, OrgChartDepartment>();

  for (const node of nodes) {
    if (!entities.has(node.entity.id)) {
      entities.set(node.entity.id, {
        id: node.entity.id,
        code: node.entity.code,
        departments: [],
        headcount: 0,
      });
    }
    entities.get(node.entity.id)!.headcount += 1;

    const key = deptKey(node);
    if (!departments.has(key)) {
      departments.set(key, {
        id: node.department?.id ?? null,
        name: node.department?.name ?? null,
        tops: [],
        headcount: 0,
      });
      entities.get(node.entity.id)!.departments.push(departments.get(key)!);
    }
    departments.get(key)!.headcount += 1;
  }

  // A CYCLE HAS NO TOP, and would otherwise erase everyone in it.
  //
  // With A managing B and B managing A, each is the other's child, so neither
  // is a top and the pair disappears from the chart completely — a silent
  // omission, which is the worst outcome available. Nothing in the database
  // prevents it (the manager edge is a plain self-relation) and the import
  // writes those edges from a spreadsheet.
  //
  // So anyone unreachable from a top is promoted to one, in name order, and
  // whatever that promotion reaches is then accounted for. Each cycle surfaces
  // exactly once rather than once per member, and `toPerson`'s `seen` guard
  // stops the recursion. The result is a visibly odd branch instead of missing
  // people.
  const reachable = new Set<string>();
  const markReachable = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const child of childrenOf.get(id) ?? []) markReachable(child.id);
  };
  for (const group of tops.values()) for (const node of group) markReachable(node.id);

  for (const node of [...nodes].sort(byName)) {
    if (reachable.has(node.id)) continue;
    const group = tops.get(deptKey(node)) ?? [];
    group.push(node);
    tops.set(deptKey(node), group);
    markReachable(node.id);
  }

  for (const [key, group] of tops) {
    const department = departments.get(key);
    if (!department) continue;
    department.tops = group.sort(byName).map((node) => toPerson(node, new Set()));
  }

  for (const entity of entities.values()) {
    entity.departments.sort((a, b) => {
      // The C-Level group first: §1.2 ties them to the entity directly, so they
      // are its top line rather than a "no department" leftover.
      if (a.id === null) return -1;
      if (b.id === null) return 1;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
  }

  return [...entities.values()].sort((a, b) => a.code.localeCompare(b.code));
}

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

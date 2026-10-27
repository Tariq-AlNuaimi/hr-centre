import {
  NAV,
  NAV_GROUPS,
  type NavContext,
  type NavEntry,
  type NavGroup,
  type NavLink,
} from "./config";

/**
 * Pure readers over `NAV` (lib/nav/config.ts): what this viewer sees, which
 * entry and tab a path belongs to, and the flat list the ⌘K palette searches.
 * No React, no I/O — unit-tested in tests/contracts/ux-nav.test.ts.
 */

export type ResolvedLink = { key: string; label: string; text?: string; href: string };
export type ResolvedEntry = ResolvedLink & {
  group: NavGroup;
  icon: NavEntry["icon"];
  tabs: ResolvedLink[];
};

export function hrefOf(link: NavLink, ctx: NavContext): string | null {
  return typeof link.href === "function" ? link.href(ctx) : link.href;
}

function resolveLink(link: NavLink, ctx: NavContext): ResolvedLink | null {
  if (!link.show(ctx)) return null;
  const href = hrefOf(link, ctx);
  if (href === null) return null;
  return { key: link.key, label: link.label, text: link.text, href };
}

/**
 * The entries this viewer may open. An entry with tabs is shown only when at
 * least one tab is, and it opens on its first visible tab — so a viewer never
 * lands on a tab they cannot use.
 */
export function visibleNav(ctx: NavContext): ResolvedEntry[] {
  const out: ResolvedEntry[] = [];
  for (const entry of NAV) {
    const self = resolveLink(entry, ctx);
    if (!self) continue;
    const tabs = (entry.tabs ?? [])
      .map((tab) => resolveLink(tab, ctx))
      .filter((t): t is ResolvedLink => t !== null);
    if (entry.tabs && tabs.length === 0) continue;
    out.push({
      ...self,
      href: tabs[0]?.href ?? self.href,
      group: entry.group,
      icon: entry.icon,
      tabs,
    });
  }
  return out;
}

/** Sidebar groups in order, each with its visible entries; empty groups are dropped. */
export function groupedNav(ctx: NavContext): Array<{ group: NavGroup; entries: ResolvedEntry[] }> {
  const entries = visibleNav(ctx);
  return NAV_GROUPS.map((group) => ({
    group,
    entries: entries.filter((e) => e.group === group),
  })).filter((g) => g.entries.length > 0);
}

/** Strip a locale prefix and trailing slash: "/en/jml/cases/" → "/jml/cases". */
export function normalisePath(pathname: string, locales: readonly string[]): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length > 0 && locales.includes(parts[0]!)) parts.shift();
  return "/" + parts.join("/");
}

export function covers(prefix: string, path: string): boolean {
  if (prefix === "/") return path === "/";
  return path === prefix || path.startsWith(prefix + "/");
}

export type ActiveNav = { entryKey: string; tabKey: string | null; prefix: string };

/**
 * The entry (and tab) a path belongs to: the LONGEST matching prefix across
 * every entry and tab, so `/jml/reports` belongs to Insights rather than to
 * Joiners & leavers, and `/hiring/panel` to "My interviews" rather than Hiring.
 * Matching is static (gates are not consulted) so the answer never depends on
 * a permission fetch that has not landed yet.
 */
export function activeNav(path: string, ctx: NavContext): ActiveNav | null {
  let best: ActiveNav | null = null;
  // On a tie the TAB wins over its own entry (both are often "/hiring"), so
  // the landing tab lights up.
  const consider = (entryKey: string, tabKey: string | null, prefixes: Array<string | null>) => {
    for (const prefix of prefixes) {
      if (prefix === null || !covers(prefix, path)) continue;
      const longer = !best || prefix.length > best.prefix.length;
      const tie = best !== null && prefix.length === best.prefix.length && tabKey !== null;
      if (longer || tie) best = { entryKey, tabKey, prefix };
    }
  };
  for (const entry of NAV) {
    consider(entry.key, null, [hrefOf(entry, ctx), ...(entry.match ?? [])]);
    for (const tab of entry.tabs ?? []) {
      consider(entry.key, tab.key, [hrefOf(tab, ctx), ...(tab.match ?? [])]);
    }
  }
  return best;
}

/** The tab bar for a path: the owning entry's visible tabs, when there are two or more. */
export function tabsFor(
  path: string,
  ctx: NavContext,
): { entry: ResolvedEntry; activeTab: string | null } | null {
  const active = activeNav(path, ctx);
  if (!active) return null;
  const entry = visibleNav(ctx).find((e) => e.key === active.entryKey);
  if (!entry || entry.tabs.length < 2) return null;
  return { entry, activeTab: active.tabKey };
}

export type PaletteItem = ResolvedLink & { parent: ResolvedLink | null; icon: NavEntry["icon"] };

/** Every destination the viewer can open, flattened for ⌘K (entries, then their tabs). */
export function paletteItems(ctx: NavContext): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const entry of visibleNav(ctx)) {
    const { tabs, group: _g, icon, ...self } = entry;
    out.push({ ...self, parent: null, icon });
    for (const tab of tabs) out.push({ ...tab, parent: self, icon });
  }
  return out;
}

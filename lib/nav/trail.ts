import { NAV, type NavContext } from "./config";
import { activeNav, covers, hrefOf, visibleNav } from "./resolve";

export type NavCrumb = { key: string; label: string; text?: string; href: string | null };

/**
 * The navigational head of a breadcrumb trail: the module entry, then its tab
 * (unless it is the module's landing tab), plus the path the rest of the trail
 * hangs off. `null` when the path belongs to no entry (the shell then falls
 * back to plain path segments). A crumb this viewer cannot open is text.
 */
export function navTrail(
  path: string,
  ctx: NavContext,
): { crumbs: NavCrumb[]; restFrom: string } | null {
  const active = activeNav(path, ctx);
  if (!active || active.entryKey === "home") return null;
  const def = NAV.find((e) => e.key === active.entryKey)!;
  const visible = visibleNav(ctx).find((e) => e.key === def.key);
  const crumbs: NavCrumb[] = [
    { key: def.key, label: def.label, text: def.text, href: visible?.href ?? null },
  ];
  const tabDef = def.tabs?.find((t) => t.key === active.tabKey);
  const firstVisible = visible?.tabs[0]?.key ?? def.tabs?.[0]?.key;
  if (tabDef && tabDef.key !== firstVisible) {
    const tab = visible?.tabs.find((t) => t.key === tabDef.key);
    crumbs.push({
      key: tabDef.key,
      label: tabDef.label,
      text: tabDef.text,
      href: tab?.href ?? null,
    });
  }
  // Segments after the owning link's own path; for an extra `match` prefix
  // (e.g. /hiring/planning under Requisitions) keep that prefix's last segment.
  const own = hrefOf(tabDef ?? def, ctx);
  const restFrom =
    own !== null && covers(own, path)
      ? own
      : active.prefix.slice(0, active.prefix.lastIndexOf("/")) || "/";
  return { crumbs, restFrom };
}

import type { ReactNode } from "react";
import { Settings2 } from "lucide-react";

/**
 * The JML group of the sidebar (F-e: a module adds its group and its keys).
 * Each item's visibility is the permission its screen needs; routes re-check.
 * Keys are `jml-<first segment after /jml>` so the active item is exact.
 */
export type JmlNavItem = { key: string; labelKey: string; href: string; icon: ReactNode };

export function jmlNavItems(can: (permission: string) => boolean): JmlNavItem[] {
  const items: Array<JmlNavItem & { show: boolean }> = [
    {
      key: "jml-settings",
      labelKey: "jmlSettings",
      href: "/jml/settings",
      icon: <Settings2 className="h-4 w-4" />,
      show: can("jml.configure") || can("jml.verifyStatutory"),
    },
  ];
  return items.filter((i) => i.show).map(({ show: _show, ...i }) => i);
}

/** The sidebar key for a path below /jml. */
export function jmlActiveKey(segments: readonly string[]): string {
  return `jml-${segments[1] ?? "home"}`;
}

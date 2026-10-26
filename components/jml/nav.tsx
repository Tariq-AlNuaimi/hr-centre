import type { ReactNode } from "react";
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Settings2,
  ShieldAlert,
  UserPlus,
} from "lucide-react";

/**
 * The JML group of the sidebar (F-e: a module adds its group and its keys).
 * Each item's visibility is the permission its screen needs; routes re-check.
 * Keys are `jml-<first segment after /jml>` so the active item is exact.
 */
export type JmlNavItem = { key: string; labelKey: string; href: string; icon: ReactNode };

export function jmlNavItems(can: (permission: string) => boolean): JmlNavItem[] {
  const items: Array<JmlNavItem & { show: boolean }> = [
    {
      key: "jml-cases",
      labelKey: "jmlCases",
      href: "/jml/cases",
      icon: <ClipboardList className="h-4 w-4" />,
      show: can("jml.view"),
    },
    {
      key: "jml-joiners",
      labelKey: "jmlJoiners",
      href: "/jml/joiners",
      icon: <UserPlus className="h-4 w-4" />,
      show: can("jml.manageJoiners"),
    },
    {
      key: "jml-calendar",
      labelKey: "jmlCalendar",
      href: "/jml/calendar",
      icon: <CalendarDays className="h-4 w-4" />,
      show: can("jml.view"),
    },
    {
      key: "jml-statutory",
      labelKey: "jmlStatutory",
      href: "/jml/statutory",
      icon: <ShieldAlert className="h-4 w-4" />,
      show: can("jml.view"),
    },
    {
      key: "jml-reports",
      labelKey: "jmlReports",
      href: "/jml/reports",
      icon: <BarChart3 className="h-4 w-4" />,
      show: can("jml.viewReports"),
    },
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

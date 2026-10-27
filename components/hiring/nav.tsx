"use client";

import {
  Briefcase,
  ClipboardCheck,
  FileSignature,
  Inbox,
  KanbanSquare,
  LibraryBig,
  Megaphone,
  LineChart,
  MessagesSquare,
  Settings2,
  Users,
  CalendarDays,
  Workflow,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useHiringMe } from "./ui/api";

/**
 * The Hiring group of the sidebar (Interview Hub's `ROLE_NAV`: a panel-only
 * reader gets My panel + Interviews; HR adds the working screens; admins add
 * settings). Keys are `hiring-<second path segment>` so the sidebar can light
 * the active item without knowing hiring's routes.
 */
type NavItem = { key: string; icon: ReactNode; label: string; onClick: () => void };

const ITEMS: Array<{ seg: string; icon: ReactNode; label: string; perm: string }> = [
  { seg: "home", icon: <Inbox className="h-4 w-4" />, label: "home", perm: "hiring.view" },
  {
    seg: "requisitions",
    icon: <Briefcase className="h-4 w-4" />,
    label: "requisitions",
    perm: "hiring.view",
  },
  {
    seg: "candidates",
    icon: <Users className="h-4 w-4" />,
    label: "candidates",
    perm: "hiring.manage",
  },
  {
    seg: "pipeline",
    icon: <KanbanSquare className="h-4 w-4" />,
    label: "pipeline",
    perm: "hiring.manage",
  },
  {
    seg: "interviews",
    icon: <CalendarDays className="h-4 w-4" />,
    label: "interviews",
    perm: "hiring.view",
  },
  {
    seg: "panel",
    icon: <MessagesSquare className="h-4 w-4" />,
    label: "panel",
    perm: "hiring.view",
  },
  {
    seg: "sourcing",
    icon: <Megaphone className="h-4 w-4" />,
    label: "sourcing",
    perm: "hiring.manage",
  },
  {
    seg: "offers",
    icon: <FileSignature className="h-4 w-4" />,
    label: "offers",
    perm: "hiring.manage",
  },
  {
    seg: "approvals",
    icon: <ClipboardCheck className="h-4 w-4" />,
    label: "approvals",
    perm: "hiring.view",
  },
  {
    seg: "insights",
    icon: <LineChart className="h-4 w-4" />,
    label: "insights",
    perm: "hiring.view",
  },
  {
    seg: "library",
    icon: <LibraryBig className="h-4 w-4" />,
    label: "library",
    perm: "hiring.manage",
  },
  { seg: "flow", icon: <Workflow className="h-4 w-4" />, label: "flow", perm: "hiring.manage" },
  {
    seg: "settings",
    icon: <Settings2 className="h-4 w-4" />,
    label: "settings",
    perm: "hiring.configure",
  },
];

/** Segments whose screens exist in this build (grows slice by slice). */
export const LIVE_SEGMENTS = new Set([
  "home",
  "requisitions",
  "candidates",
  "pipeline",
  "import",
  "library",
  "flow",
  "approvals",
  "interviews",
  "panel",
  "evaluations",
  "offers",
  "close-out",
  "sourcing",
  "settings",
  "insights",
]);

export function useHiringNavItems(): NavItem[] {
  const t = useTranslations("hiring.nav");
  const router = useRouter();
  const locale = useLocale();
  const { has } = useHiringMe();
  return ITEMS.filter((i) => LIVE_SEGMENTS.has(i.seg) && has(i.perm)).map((i) => ({
    key: `hiring-${i.seg}`,
    icon: i.icon,
    label: t(i.label),
    onClick: () =>
      router.push(i.seg === "home" ? `/${locale}/hiring` : `/${locale}/hiring/${i.seg}`),
  }));
}

/** `/hiring/requisitions/…` → `hiring-requisitions`; `/hiring` → `hiring-home`. */
export function hiringActiveKey(segments: readonly string[]): string | null {
  if (segments[0] !== "hiring") return null;
  const seg = segments[1] ?? "home";
  const parent: Record<string, string> = {
    planning: "requisitions",
    import: "candidates",
    evaluations: "interviews",
  };
  return `hiring-${parent[seg] ?? seg}`;
}

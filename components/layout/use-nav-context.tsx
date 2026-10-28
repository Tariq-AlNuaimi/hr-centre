"use client";

import {
  Award,
  BarChart3,
  Briefcase,
  CalendarDays,
  ClipboardCheck,
  Home,
  Inbox,
  LayoutGrid,
  MessagesSquare,
  Network,
  Settings2,
  ShieldCheck,
  Trash2,
  User,
  UserRoundCheck,
  Users,
  ArrowLeftRight,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { usePmsActor } from "@/hooks/use-pms-actor";
import { useHiveAccess } from "@/components/hive/use-hive-access";
import { useJmlAccess } from "@/components/jml/use-jml";
import { useHiringMe } from "@/components/hiring/ui/api";
import type { NavContext, NavIcon } from "@/lib/nav/config";

/**
 * The viewer's navigation context, assembled from the access hooks the shell
 * already uses (each fails closed while loading). AFFORDANCES only — every
 * route re-checks on the server.
 */
export function useNavContext(): NavContext {
  const { data: session } = useSession();
  const { actor, capabilities: c } = usePmsActor();
  const hive = useHiveAccess();
  const jml = useJmlAccess();
  const hiring = useHiringMe();
  const isAdmin = session?.user?.role === "ADMIN";
  const employeeId = actor?.employeeId ?? null;
  return {
    isAdmin,
    employeeId,
    pms: {
      hr: c.hr,
      lineManager: c.lineManager,
      orgWide: c.orgWide,
      runCalibration: c.runCalibration,
      previewImport: c.previewImport,
      orgManage: c.orgManage,
      loginsManage: c.loginsManage,
    },
    hive: {
      // QA D-03: a Drafter/Approver opens the queue (limited to their pairs).
      seeTickets: hive.seeTickets || hive.draftEscalation || hive.approve,
      viewReports: hive.viewReports,
      editContent: hive.editContent,
      configure: hive.configure,
    },
    jml: jml.can,
    jmlTaskWorker: jml.taskWorker,
    hiring: hiring.has,
  };
}

const ICONS: Record<NavIcon, ReactNode> = {
  home: <Home className="h-4 w-4" />,
  user: <User className="h-4 w-4" />,
  award: <Award className="h-4 w-4" />,
  interviews: <MessagesSquare className="h-4 w-4" />,
  team: <UserRoundCheck className="h-4 w-4" />,
  users: <Users className="h-4 w-4" />,
  network: <Network className="h-4 w-4" />,
  lifecycle: <ArrowLeftRight className="h-4 w-4" />,
  briefcase: <Briefcase className="h-4 w-4" />,
  cycles: <CalendarDays className="h-4 w-4" />,
  inbox: <Inbox className="h-4 w-4" />,
  insights: <BarChart3 className="h-4 w-4" />,
  settings: <Settings2 className="h-4 w-4" />,
  shield: <ShieldCheck className="h-4 w-4" />,
  audit: <ClipboardCheck className="h-4 w-4" />,
  trash: <Trash2 className="h-4 w-4" />,
  grid: <LayoutGrid className="h-4 w-4" />,
};

export function navIcon(icon: NavIcon): ReactNode {
  return ICONS[icon];
}

/** A nav link's display label (message key, or a scaffolded entity's literal). */
export function useNavLabel(): (link: { label: string; text?: string }) => string {
  const t = useTranslations("nav");
  return (link) => link.text ?? t(link.label);
}

/** `/x` → `/<locale>/x`; `/` → `/<locale>`. */
export function useLocaleHref(): (href: string) => string {
  const locale = useLocale();
  return (href) => (href === "/" ? `/${locale}` : `/${locale}${href}`);
}

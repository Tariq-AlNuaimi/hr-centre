"use client";

import {
  Home,
  Users,
  Network,
  Upload,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  ShieldCheck,
  Settings,
  Trash2,
  ClipboardCheck,
  Award,
  BarChart3,
  LineChart,
  Scale,
  UserRoundCheck,
  Target,
  UserMinus,
  Menu as MenuIcon,
  PanelLeftClose,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { localePrefixRegex } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { usePmsActor } from "@/hooks/use-pms-actor";

export function AppSidebar() {
  const t = useTranslations("nav");
  const tChrome = useTranslations("chrome");
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const { data: session } = useSession();
  // PMS authority lives on the Employee record, not the session (ADR-065), so
  // the nav asks for it. `usePmsActor` fails closed while loading: a non-HR user
  // never sees a flash of HR-only navigation.
  const { actor, capabilities } = usePmsActor();
  const [collapsed, setCollapsed] = useState(false);

  // Mirror AntD Sider `breakpoint="lg"` (992px): auto-collapse to icons below
  // the lg breakpoint, while still allowing a manual toggle above it.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 991px)");
    const apply = (matches: boolean) => setCollapsed(matches);
    apply(mq.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // types/index.ts augments next-auth's Session.user with role: Role,
  // so this access is typed -- no `as any` needed.
  const isAdmin = session?.user?.role === "ADMIN";

  // PMS roles are additive (§4.3) and fail closed: an unresolved actor has none,
  // so a non-HR user never sees a flash of HR-only navigation.
  const pmsRoles = actor?.pmsRoles ?? [];

  // Active-item matching (locale prefix stripped first). The first path segment
  // identifies most items, but every PMS admin screen lives under /admin/*, so
  // the SECOND segment is what tells them apart — a first-segment-only match
  // would light up all of them at once. /admin/import keeps the "admin" key.
  const segments = pathname.replace(localePrefixRegex, "").split("/").filter(Boolean);
  const ADMIN_SEGMENT_KEYS: Record<string, string> = {
    "org-setup": "org-setup",
    cycles: "cycles",
    access: "access",
    "strategy-scores": "strategy-scores",
    "edge-cases": "edge-cases",
  };
  const activeKey =
    segments[0] === "admin"
      ? (ADMIN_SEGMENT_KEYS[segments[1] ?? ""] ?? "admin")
      : (segments[0] ?? "home");

  const menuItems = [
    {
      key: "home",
      icon: <Home className="h-4 w-4" />,
      label: t("home"),
      onClick: () => router.push(`/${locale}`),
    },
    // ADR-070 — "Users" and "HR roles" became ONE entry, "Access", further down
    // beside the other admin screens. It is shown to a platform admin OR an HR
    // Super Admin, because each governs one half of what that screen shows.
    ...(isAdmin
      ? [
          {
            key: "audit-log",
            icon: <ClipboardCheck className="h-4 w-4" />,
            label: t("auditLog"),
            onClick: () => router.push(`/${locale}/audit-log`),
          },
        ]
      : []),
    // --- Performance management (spec §4.4) ------------------------------
    // "Oversight" surfaces: what this user is entitled to SEE. Everyone with an
    // employee record gets the directory and the org chart — the ROUTES scope
    // the rows, so a plain employee simply sees themselves rather than being
    // denied a page that exists for them.
    {
      key: "people",
      icon: <Users className="h-4 w-4" />,
      label: t("people"),
      onClick: () => router.push(`/${locale}/people`),
    },
    {
      key: "org",
      icon: <Network className="h-4 w-4" />,
      label: t("org"),
      onClick: () => router.push(`/${locale}/org`),
    },
    // §13.1 — every employee has a scorecard, published or not. The screen says
    // "not yet" before publication rather than being hidden, because §13.2's
    // silence is about RESULTS, not about the existence of the page.
    {
      key: "scorecard",
      icon: <Award className="h-4 w-4" />,
      label: t("scorecard"),
      onClick: () => router.push(`/${locale}/scorecard`),
    },
    {
      // §6.2 — mid-year is an EVERY-EMPLOYEE screen since UAT Scenario C. It
      // used to sit in the manager/HR block below, because the only thing that
      // happened here was a manager raising a change request. Now a change to
      // someone's KPIs is something they are asked to acknowledge, and a
      // request nobody can see is not a change anyone agreed to — so this sits
      // with "My scorecard", which is where an employee's own record lives.
      // Managers and HR get the roster on the same route; the page branches.
      key: "mid-year",
      icon: <CalendarClock className="h-4 w-4" />,
      label: t("midYear"),
      onClick: () => router.push(`/${locale}/mid-year`),
    },
    // Goal setting (§5) is the LINE MANAGER's workspace, so it is gated on the
    // relationship — `capabilities.lineManager` is derived from
    // `Employee.managerId` edges, not from a role name (§4.2) — plus HR's
    // org-wide override (§4.1). Roles are additive, so this is an OR (§4.3).
    // An employee with no reports has no roster to work: their own KPI set
    // reaches them through My Tasks on the home page, not through a nav item
    // that would open an empty screen.
    ...(capabilities.lineManager || pmsRoles.includes("HR_SUPER_ADMIN") || pmsRoles.includes("HRBP")
      ? [
          // §13.3's manager workspace — the cockpit a manager checks before an
          // escalation fires, so it sits above the three stage screens.
          {
            key: "team",
            icon: <UserRoundCheck className="h-4 w-4" />,
            label: t("team"),
            onClick: () => router.push(`/${locale}/team`),
          },
          {
            key: "goal-setting",
            icon: <ClipboardList className="h-4 w-4" />,
            label: t("goalSetting"),
            onClick: () => router.push(`/${locale}/goal-setting`),
          },
          // Year-end (§7) — the same audience again: the employee's own
          // assessment reaches them through My Tasks, the manager reviews their
          // direct reports here, HR oversees org-wide.
          {
            key: "year-end",
            icon: <ClipboardCheck className="h-4 w-4" />,
            label: t("yearEnd"),
            onClick: () => router.push(`/${locale}/year-end`),
          },
        ]
      : []),
    // §13.5's reports and §13.6's dashboard need ORG-WIDE sight, which is HR
    // plus the COO and Ops Director (§4.1). Wider than the HR-only screens
    // below, and narrower than the manager workspace above.
    ...(capabilities.orgWide
      ? [
          {
            key: "reports",
            icon: <BarChart3 className="h-4 w-4" />,
            label: t("reports"),
            onClick: () => router.push(`/${locale}/reports`),
          },
          {
            key: "executive",
            icon: <LineChart className="h-4 w-4" />,
            label: t("executive"),
            onClick: () => router.push(`/${locale}/executive`),
          },
        ]
      : []),
    // The cycle console. §4.1 gives BOTH HR flavours "runs the cycle org-wide"
    // (`canRunCycle` at the route), which is wider than `capabilities.configure`
    // — so it is read off the actor's own roles, not a capability flag.
    ...(pmsRoles.includes("HR_SUPER_ADMIN") || pmsRoles.includes("HRBP")
      ? [
          {
            key: "cycles",
            icon: <CalendarDays className="h-4 w-4" />,
            label: t("cycles"),
            onClick: () => router.push(`/${locale}/admin/cycles`),
          },
          // §9.4 — "HR selects and manages all rater assignments."
          {
            key: "three-sixty",
            icon: <Target className="h-4 w-4" />,
            label: t("threeSixty"),
            onClick: () => router.push(`/${locale}/three-sixty`),
          },
          // §8.4 — the Strategy team has no system access, so HR keys their
          // figures in.
          {
            key: "strategy-scores",
            icon: <Target className="h-4 w-4" />,
            label: t("strategyScores"),
            onClick: () => router.push(`/${locale}/admin/strategy-scores`),
          },
          // §12 — the roll-up prompt has to live somewhere HR looks.
          {
            key: "edge-cases",
            icon: <UserMinus className="h-4 w-4" />,
            label: t("edgeCases"),
            onClick: () => router.push(`/${locale}/admin/edge-cases`),
          },
        ]
      : []),
    // §10.6 — "HRBP does not touch calibration", so this one is Super Admin
    // alone, matching `canRunCalibration` at the route.
    ...(capabilities.runCalibration
      ? [
          {
            key: "calibration",
            icon: <Scale className="h-4 w-4" />,
            label: t("calibration"),
            onClick: () => router.push(`/${locale}/calibration`),
          },
        ]
      : []),
    // HR-only administration. Import is open to HRBP (checking a file is part of
    // running the cycle); org setup is Super-Admin-only (§4.1's configure column).
    ...(capabilities.previewImport
      ? [
          {
            key: "admin",
            icon: <Upload className="h-4 w-4" />,
            label: t("employeeImport"),
            onClick: () => router.push(`/${locale}/admin/import`),
          },
        ]
      : []),
    ...(capabilities.configure
      ? [
          {
            key: "org-setup",
            icon: <Building2 className="h-4 w-4" />,
            label: t("orgSetup"),
            onClick: () => router.push(`/${locale}/admin/org-setup`),
          },
        ]
      : []),
    // ADR-070 — the merged access screen: logins + platform administration
    // (platform ADMIN's half) and §4.1 HR authority (HR Super Admin's half).
    //
    // The UNION, not the intersection: each audience governs one half and the
    // page shows the other half read-only with the reason. §4.1 keeps granting
    // HR authority to Super Admins only (HRBP is "Configures? No"), which is
    // still the RoleEditor's own gate inside the page.
    ...(isAdmin || pmsRoles.includes("HR_SUPER_ADMIN")
      ? [
          {
            key: "access",
            icon: <ShieldCheck className="h-4 w-4" />,
            label: t("access"),
            onClick: () => router.push(`/${locale}/admin/access`),
          },
        ]
      : []),
    // Scaffolded entities land here — `/scaffold-entity` appends a nav item per
    // entity, above the recycling bin.
    {
      key: "recycling-bin",
      icon: <Trash2 className="h-4 w-4" />,
      label: t("recyclingBin"),
      onClick: () => router.push(`/${locale}/recycling-bin`),
    },
    {
      key: "settings",
      icon: <Settings className="h-4 w-4" />,
      label: t("settings"),
      onClick: () => router.push(`/${locale}/settings`),
    },
    // NOTE: scaffolded entity nav entries are inserted before the recycling-bin
    // item above (see scripts/scaffold-entity.mjs patchSidebar marker) -- keep
    // that literal intact.
  ].filter((item) => item.key !== "recycling-bin" || isAdmin); // bin is admin-only (API is withAdminAuth)

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-e border-border bg-card pt-2 transition-[width] duration-200",
        collapsed ? "w-16" : "w-56",
      )}
    >
      <nav className="flex flex-1 flex-col gap-1 px-2">
        {menuItems.map((item) => {
          const isActive = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                collapsed && "justify-center",
                isActive
                  ? "bg-accent-subtle font-medium text-nav-active-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="inline-flex shrink-0">{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="p-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={tChrome("toggleSidebar")}
          aria-expanded={!collapsed}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
            collapsed && "justify-center",
          )}
        >
          {collapsed ? <MenuIcon className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}

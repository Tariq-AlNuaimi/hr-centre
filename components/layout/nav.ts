import {
  LayoutDashboard,
  FileText,
  Send,
  Users,
  Columns3,
  SlidersHorizontal,
  Settings,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

export type NavSection = "main" | "assess" | "admin";

export type NavItem = {
  /** i18n key under the `nav` namespace. */
  key:
    | "dashboard"
    | "roleProfiles"
    | "invitations"
    | "candidates"
    | "compare"
    | "calibration"
    | "settings"
    | "audit";
  /** Path under /[locale]/app (locale-aware Link adds the prefix). */
  href: string;
  icon: LucideIcon;
  section: NavSection;
  /** Visible to HR_ADMIN only when true (server-gated too). */
  adminOnly?: boolean;
};

// Single source of truth for the app nav (UI-SPEC Part B / D). Managers see a
// subset; admin-only items are also enforced server-side (lib/authz).
export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", href: "/app", icon: LayoutDashboard, section: "main" },
  { key: "roleProfiles", href: "/app/roles", icon: FileText, section: "assess", adminOnly: true },
  { key: "invitations", href: "/app/invites", icon: Send, section: "assess", adminOnly: true },
  { key: "candidates", href: "/app/candidates", icon: Users, section: "assess" },
  { key: "compare", href: "/app/compare", icon: Columns3, section: "assess" },
  { key: "calibration", href: "/app/calibration", icon: SlidersHorizontal, section: "admin", adminOnly: true },
  { key: "settings", href: "/app/settings", icon: Settings, section: "admin", adminOnly: true },
  { key: "audit", href: "/app/audit", icon: ScrollText, section: "admin", adminOnly: true },
];

export const NAV_SECTIONS: { id: NavSection; labelKey: string }[] = [
  { id: "main", labelKey: "sectionMain" },
  { id: "assess", labelKey: "sectionAssess" },
  { id: "admin", labelKey: "sectionAdmin" },
];

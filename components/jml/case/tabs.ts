type CaseType = "JOIN" | "MOVE" | "LEAVE";

/**
 * UX P1 (perf-jml P1-4): five tabs at most. The leaver's eleven panels are
 * grouped by the job: what the case is (overview, approvals, compliance), the
 * exit itself (interview, settlement), paperwork and assets (documents,
 * register), and the trail (activity, emails). Old `?tab=` links still land
 * on the tab that now holds their panel.
 */
const TABS = ["checklist", "overview", "exit", "documents", "activity"] as const;
export type Tab = (typeof TABS)[number];

export const TABS_FOR: Record<CaseType, readonly Tab[]> = {
  JOIN: ["checklist", "overview", "documents", "activity"],
  MOVE: ["checklist", "overview", "activity"],
  LEAVE: ["checklist", "overview", "exit", "documents", "activity"],
};

const LEGACY_TAB: Record<string, Tab> = {
  approvals: "overview",
  compliance: "overview",
  interview: "exit",
  settlement: "exit",
  register: "documents",
  emails: "activity",
};

export function tabFrom(param: string | null): Tab {
  if (!param) return "checklist";
  return (TABS as readonly string[]).includes(param)
    ? (param as Tab)
    : (LEGACY_TAB[param] ?? "checklist");
}

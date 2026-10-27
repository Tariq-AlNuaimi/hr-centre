import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * The employee record's tabs — blueprint F-e: "the base later modules add
 * their tabs to", regrouped by data category in UX P1 (R10): the core
 * categories first (Personal, Documents & IDs and Compensation only for a
 * viewer entitled to them), then the module tabs, then History. Tabs are links
 * (`?tab=`), so each is addressable, works without JavaScript, and the server
 * renders only the panel shown.
 */
export const RECORD_TABS = [
  "overview",
  "job",
  "personal",
  "documents",
  "compensation",
  "performance",
  "tickets",
  "jml",
  "hiring",
  "history",
] as const;
export type RecordTab = (typeof RECORD_TABS)[number];

export function parseRecordTab(value: string | string[] | undefined): RecordTab {
  return RECORD_TABS.find((tab) => tab === value) ?? "overview";
}

export function RecordTabs({
  basePath,
  active,
  hidden = [],
}: {
  basePath: string;
  active: RecordTab;
  /** Tabs this viewer may not open (e.g. "tickets" without `tickets.see`). */
  hidden?: readonly RecordTab[];
}) {
  const t = useTranslations("people.tabs");
  return (
    <nav aria-label={t("label")} className="flex gap-1 overflow-x-auto border-b border-border">
      {RECORD_TABS.filter((tab) => !hidden.includes(tab)).map((tab) => (
        <Link
          key={tab}
          href={tab === "overview" ? basePath : `${basePath}?tab=${tab}`}
          aria-current={tab === active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-4 py-2 text-sm whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
            tab === active
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t(tab)}
        </Link>
      ))}
    </nav>
  );
}

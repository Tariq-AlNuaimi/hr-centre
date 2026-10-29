"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Building2, ChevronRight, Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/EmptyState";
import type { OrgChartEntity, OrgChartPerson } from "@/lib/pms/org-chart";
import { matchOrgChart } from "@/lib/pms/org-chart-search";

/**
 * §4.2's reporting tree, as an org chart a person can actually navigate.
 *
 * ## Why this became a client component
 *
 * The old page was server-rendered and that was right for what it did: a
 * read-only indented list costs no client JavaScript. Collapsing and searching
 * are not read-only — they are per-reader state — and doing them on the server
 * would mean a round trip per toggle on a tree the reader is scanning. The DATA
 * is still fetched and scoped on the server (§4.2 decides what exists before
 * this component sees anything); only the arranging and hiding happen here.
 *
 * ## Collapsed by default below the department
 *
 * Entities and departments open; reporting lines start shut, with the count on
 * the toggle. Two hundred people expanded at once is the problem this replaces,
 * and a reader looking for one team should not have to scroll past four others.
 *
 * ## Search drives expansion, not just filtering
 *
 * Hiding non-matches alone would leave a match sitting inside a collapsed
 * branch — found and invisible. `matchOrgChart` returns the matches AND the
 * path to them in one pass, so a row cannot be kept without being revealed.
 */

/**
 * Below this, the whole reporting line fits on a screen and hiding it helps
 * nobody. Above it, the point of the redesign is that it does not.
 */
const SMALL_ORG = 60;

export function OrgChart({
  entities,
  locale,
  totalCount,
  initialQuery = "",
}: {
  entities: OrgChartEntity[];
  locale: string;
  totalCount: number;
  /** Pre-filled search (`/org?q=` — "View in org chart" from a record). */
  initialQuery?: string;
}) {
  const t = useTranslations("pms.org");
  const tPms = useTranslations("pms");
  const withHead = useWithHead();
  const [query, setQuery] = useState(initialQuery);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /**
   * Whether reporting lines start open — the "readable at 20 to 200 people"
   * requirement, made concrete.
   *
   * Collapsing everything below the department is right for a large org and
   * wrong for a small one: at thirty-odd people it hides the whole chart
   * behind eleven department heads, which is a different failure from the
   * unbroken column it replaced. So the default follows the size, and
   * `allOpen` lets the reader override it in either direction.
   */
  const [allOpen, setAllOpen] = useState<boolean | null>(null);
  const linesOpenByDefault = allOpen ?? totalCount <= SMALL_ORG;

  const { matched, onPath } = useMemo(() => matchOrgChart(entities, query), [entities, query]);
  const searching = query.trim() !== "";

  // Open when searching (the path decides), otherwise the reader's own toggles
  // over a default of "groups open, reporting lines shut".
  const isOpen = (id: string, defaultOpen: boolean) => {
    if (searching) return onPath.has(id);
    return collapsed.has(id) ? !defaultOpen : defaultOpen;
  };
  const setAll = (open: boolean) => {
    // Clears the per-row overrides too: "expand all" that leaves three rows
    // shut because they were toggled earlier has not expanded all.
    setCollapsed(new Set());
    setAllOpen(open);
  };
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Does this person, or anyone under them, survive the current search? */
  const visible = (person: OrgChartPerson): boolean =>
    !searching || matched.has(person.id) || onPath.has(person.id);

  const resultCount = matched.size;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="org-search">{t("search")}</Label>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute inset-inline-start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="org-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="ps-9"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {searching
              ? t("searchResults", { count: resultCount })
              : t("countLabel", { count: totalCount })}
          </p>
          {/* Explicit, because the size-aware default cannot be right for
              everyone: a reader on a 200-person org may want one department
              fully open, and a reader on a 30-person one may want it all shut.
              Hidden while searching, where the matches decide what is open and
              these would only fight them. */}
          {!searching ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAll(true)}>
                {t("expandAll")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAll(false)}>
                {t("collapseAll")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {searching && resultCount === 0 ? (
        <EmptyState description={t("noMatches", { query: query.trim() })} />
      ) : (
        <ul className="list-none space-y-4">
          {entities.map((entity) => {
            if (searching && !onPath.has(entity.id)) return null;
            const open = isOpen(entity.id, true);
            return (
              <li key={entity.id}>
                <Disclosure
                  open={open}
                  onToggle={() => toggle(entity.id)}
                  icon={<Building2 aria-hidden className="h-4 w-4 text-muted-foreground" />}
                  label={entity.code}
                  meta={withHead(t("peopleCount", { count: entity.headcount }), entity.headName)}
                  level="entity"
                />

                {open ? (
                  <ul className="ms-2 list-none space-y-3 border-s border-border ps-4 pt-2">
                    {entity.departments.map((department) => {
                      const key = `${entity.id}::${department.id ?? ""}`;
                      if (searching && !onPath.has(key)) return null;
                      const deptOpen = isOpen(key, true);
                      return (
                        <li key={key}>
                          <Disclosure
                            open={deptOpen}
                            onToggle={() => toggle(key)}
                            icon={<Users aria-hidden className="h-4 w-4 text-muted-foreground" />}
                            // §1.2 — the null group is exactly the C-Level, so
                            // it is named for what it is rather than shown as a
                            // missing value.
                            label={department.name ?? t("executiveGroup")}
                            meta={withHead(
                              t("peopleCount", { count: department.headcount }),
                              department.headName,
                            )}
                            level="department"
                          />

                          {deptOpen ? (
                            <ul className="ms-2 list-none border-s border-border ps-4 pt-1">
                              {department.tops.filter(visible).map((person) => (
                                <PersonRow
                                  key={person.id}
                                  person={person}
                                  locale={locale}
                                  t={t}
                                  trackLabel={(track) => tPms(`track.${track}`)}
                                  statusLabel={(status) => tPms(`statusValue.${status}`)}
                                  isOpen={isOpen}
                                  toggle={toggle}
                                  visible={visible}
                                  matched={matched}
                                  linesOpenByDefault={linesOpenByDefault}
                                />
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * One collapsible group header.
 *
 * A real `<button>` with `aria-expanded`, not a clickable div: the whole point
 * of this redesign is navigating a 200-person tree, and a keyboard or screen
 * reader user navigates it through exactly this control.
 */
/** "Head: Name · 12 people" when the unit has a head (overnight item 2). */
function useWithHead() {
  const tHead = useTranslations("org.head");
  return (count: string, head: string | null) =>
    head ? `${tHead("label", { name: head })} · ${count}` : count;
}

function Disclosure({
  open,
  onToggle,
  icon,
  label,
  meta,
  level,
}: {
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
  meta: string;
  level: "entity" | "department";
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-muted/50"
    >
      <ChevronRight
        aria-hidden
        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
          open ? "rotate-90" : ""
        } rtl:-scale-x-100`}
      />
      {icon}
      <span className={level === "entity" ? "font-semibold" : "font-medium"}>{label}</span>
      <span className="text-xs text-muted-foreground">{meta}</span>
    </button>
  );
}

function PersonRow({
  person,
  locale,
  t,
  trackLabel,
  statusLabel,
  isOpen,
  toggle,
  visible,
  matched,
  linesOpenByDefault,
}: {
  person: OrgChartPerson;
  locale: string;
  t: (key: string, values?: Record<string, string | number>) => string;
  trackLabel: (track: string) => string;
  statusLabel: (status: string) => string;
  isOpen: (id: string, defaultOpen: boolean) => boolean;
  toggle: (id: string) => void;
  linesOpenByDefault: boolean;
  visible: (person: OrgChartPerson) => boolean;
  matched: Set<string>;
}) {
  const hasReports = person.reports.length > 0;
  // Reporting lines start SHUT: the unbroken 200-row column is the problem
  // being fixed, and the count on the toggle says what is behind it.
  const open = isOpen(person.id, linesOpenByDefault);
  const shown = person.reports.filter(visible);

  return (
    <li>
      <div className="flex flex-wrap items-center gap-2 py-1">
        {hasReports ? (
          <button
            type="button"
            onClick={() => toggle(person.id)}
            aria-expanded={open}
            aria-label={t("toggleReports", { name: person.name, count: person.descendantCount })}
            className="flex w-9 items-center justify-start gap-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted/50"
          >
            <ChevronRight
              aria-hidden
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""} rtl:-scale-x-100`}
            />
            {person.descendantCount}
          </button>
        ) : (
          // Keeps the names on one vertical line whether or not a row has a
          // toggle — without it every leaf sits 20px left of its siblings.
          // Matches the toggle's width exactly, so a name without reports sits
          // on the same vertical line as one with them.
          <span aria-hidden className="inline-block w-9" />
        )}

        <Link
          href={`/${locale}/people/${person.id}`}
          className={`underline-offset-4 hover:underline ${
            matched.has(person.id)
              ? "font-semibold text-brand-emphasis"
              : "font-medium text-foreground"
          }`}
        >
          {person.name}
        </Link>

        <Badge variant={person.roleTrack === "C_LEVEL" ? "brand" : "default"}>
          {trackLabel(person.roleTrack)}
        </Badge>
        {person.status !== "ACTIVE" ? (
          <Badge variant="warning">{statusLabel(person.status)}</Badge>
        ) : null}

        {/* A line that leaves this department, stated rather than dropped —
            §12.1's roll-up and §12.3's transfer both produce these. */}
        {person.reportsToName ? (
          <span className="text-xs text-muted-foreground">
            {t("reportsTo", { name: person.reportsToName })}
          </span>
        ) : null}
      </div>

      {hasReports && open && shown.length > 0 ? (
        // `ms-*` + `border-s-*` are logical properties, so the indent and its
        // guide line mirror correctly under RTL without a second rule.
        <ul className="ms-3 list-none border-s border-border ps-4">
          {shown.map((report) => (
            <PersonRow
              key={report.id}
              person={report}
              locale={locale}
              t={t}
              trackLabel={trackLabel}
              statusLabel={statusLabel}
              isOpen={isOpen}
              toggle={toggle}
              visible={visible}
              matched={matched}
              linesOpenByDefault={linesOpenByDefault}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

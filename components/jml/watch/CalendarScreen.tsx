"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlLookups } from "../use-jml";
import { CalendarTotals, type Totals } from "./CalendarTotals";

type Entry = {
  caseId: string;
  fullName: string;
  jobTitle: string | null;
  company: string;
  department: string | null;
  employmentType: string | null;
  workLocation: string | null;
  hrOwner: string | null;
  date: string;
  confirmed: boolean;
  status: string;
  onWeekend: boolean;
};

type View = "month" | "week" | "list";

const iso = (d: Date) => d.toISOString().slice(0, 10);

function rangeOf(view: View, anchor: Date): { from: Date; to: Date } {
  if (view === "week") {
    const from = new Date(anchor);
    from.setUTCDate(from.getUTCDate() - from.getUTCDay()); // Sunday-first
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 6);
    return { from, to };
  }
  const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  return { from, to };
}

function shift(view: View, anchor: Date, dir: 1 | -1): Date {
  const next = new Date(anchor);
  if (view === "week") next.setUTCDate(next.getUTCDate() + 7 * dir);
  else next.setUTCMonth(next.getUTCMonth() + dir, 1);
  return next;
}

/** The joining calendar (Onboarding §12): month, week or list, with range totals. */
export function CalendarScreen() {
  const t = useTranslations("jml.calendar");
  const { can, isLoading } = useJmlAccess();
  const lookups = useJmlLookups(can("jml.view"));
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(() => new Date(`${iso(new Date())}T00:00:00Z`));
  const [entityId, setEntityId] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const { from, to } = rangeOf(view, anchor);
  const params = new URLSearchParams({
    from: iso(from),
    to: iso(to),
    ...(entityId ? { entityId } : {}),
    ...(status ? { status } : {}),
    ...(owner ? { hrOwnerUserId: owner } : {}),
  });
  const data = useQuery({
    queryKey: ["jml", "calendar", params.toString()],
    queryFn: () =>
      apiClient.get<{ entries: Entry[]; truncated: boolean; totals: Totals }>(
        `/api/jml/calendar?${params}`,
      ),
    enabled: can("jml.view"),
  });
  if (isLoading) return <LoadingBlock />;
  if (!can("jml.view")) return <NotPermitted title={t("title")} />;
  const entries = data.data?.entries ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <a
            className={buttonVariants({ variant: "outline" })}
            href={`/api/jml/calendar/export?${params}`}
          >
            {t("export")}
          </a>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setAnchor(shift(view, anchor, -1))}>
          {t("previous")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAnchor(new Date(`${iso(new Date())}T00:00:00Z`))}
        >
          {t("today")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setAnchor(shift(view, anchor, 1))}>
          {t("next")}
        </Button>
        <span className="text-sm font-medium">{t("range", { from: iso(from), to: iso(to) })}</span>
        <NativeSelect
          aria-label={t("view")}
          value={view}
          onChange={(e) => setView(e.target.value as View)}
        >
          {(["month", "week", "list"] as const).map((v) => (
            <option key={v} value={v}>
              {t(`views.${v}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t("company")}
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
        >
          <option value="">{t("allCompanies")}</option>
          {(lookups.data?.companies ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t("owner")}
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">{t("allOwners")}</option>
          {(lookups.data?.hrUsers ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.email}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t("status")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t("allStatuses")}</option>
          {["DRAFT", "ACTIVE", "COMPLETED"].map((s) => (
            <option key={s} value={s}>
              {t(`statusValue.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {data.isLoading ? (
        <LoadingBlock />
      ) : data.isError || !data.data ? (
        <LoadFailed />
      ) : (
        <>
          {data.data.truncated ? (
            <p className="text-sm text-muted-foreground">{t("truncated")}</p>
          ) : null}
          <SectionCard title={t(`views.${view}`)}>
            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {entityId || status || owner ? t("emptyFiltered") : t("emptyRange")}
              </p>
            ) : view === "list" ? (
              <ListView entries={entries} />
            ) : (
              <GridView entries={entries} from={from} to={to} />
            )}
          </SectionCard>
          <CalendarTotals totals={data.data.totals} />
          <p className="text-xs text-muted-foreground">{t("footnote")}</p>
        </>
      )}
    </div>
  );
}

function EntryLink({ e }: { e: Entry }) {
  const t = useTranslations("jml.calendar");
  return (
    <Link
      href={`/jml/joiners/${e.caseId}`}
      className="block truncate text-xs text-primary hover:underline"
    >
      {e.fullName}
      {e.confirmed ? ` ${t("confirmedMark")}` : ""}
    </Link>
  );
}

function GridView({ entries, from, to }: { entries: Entry[]; from: Date; to: Date }) {
  const t = useTranslations("jml.calendar");
  const start = new Date(from);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const days: Date[] = [];
  for (
    const d = new Date(start);
    d <= to || d.getUTCDay() !== 0;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    days.push(new Date(d));
  }
  const byDay = new Map<string, Entry[]>();
  for (const e of entries) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  return (
    <div className="grid grid-cols-7 gap-1">
      {["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => (
        <div key={d} className="p-1 text-xs font-medium text-muted-foreground">
          {t(`weekday.${d}`)}
        </div>
      ))}
      {days.map((d) => {
        const key = iso(d);
        const inRange = d >= from && d <= to;
        const list = byDay.get(key) ?? [];
        return (
          <div
            key={key}
            className={`min-h-20 rounded-md border border-border p-1 ${inRange ? "" : "opacity-40"} ${
              list.some((e) => e.onWeekend) ? "bg-muted" : ""
            }`}
          >
            <div className="text-xs tabular-nums text-muted-foreground">{d.getUTCDate()}</div>
            {list.map((e) => (
              <EntryLink key={e.caseId} e={e} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ListView({ entries }: { entries: Entry[] }) {
  const t = useTranslations("jml.calendar");
  return (
    <ul className="divide-y divide-border">
      {entries.map((e) => (
        <li key={e.caseId} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
          <span>
            <EntryLink e={e} />
            <span className="text-xs text-muted-foreground">
              {[e.jobTitle, e.department, e.company, e.workLocation].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {t("listMeta", {
              date: e.date,
              owner: e.hrOwner ?? t("noOwner"),
              status: t(`statusValue.${e.status}`),
            })}
            {e.onWeekend ? ` ${t("weekendMark")}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

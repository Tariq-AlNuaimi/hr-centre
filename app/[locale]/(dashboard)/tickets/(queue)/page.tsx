"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { FilterBar, FilterChips, FilterSelect } from "@/components/shared/FilterBar";
import { AgeingBadge } from "@/components/hive/escalations/AgeingBadge";
import { formatDay } from "@/lib/format";
import { useSourceLabels, useStatusLabels } from "@/components/hive/escalations/status-labels";
import { StatusPill } from "@/components/hive/escalations/StatusPill";
import { apiClient } from "@/lib/api-client";
import { formatTicketId } from "@/lib/hive/ticket-id";

/**
 * §5.4's queue (US10, AC-10.1).
 *
 * Company-wide by default, because §5.3 gives the HR accounts one shared queue
 * rather than five private ones. US-T6's filters (HR pair, source, dates,
 * search) narrow it only when the reader picks one — nothing defaults to
 * "mine", which would look like least privilege and contradict AC-10.1. The
 * status chips carry live counts for whatever the other filters select.
 *
 * The rows carry no transcript and no link to one: AC-10.1's second half is that
 * the conversation before an escalation stays private to the employee, and
 * the API's own select is what enforces it — this screen could not show one if
 * it wanted to.
 *
 * Ordered worst-first by age within status, which is what the API returns.
 * SEND_FAILED is deliberately not sorted to the top: it is a status badge like
 * any other, and a row that has been sitting for a week matters more than one
 * whose SMTP hiccuped a minute ago.
 */

interface QueueRow {
  id: string;
  ticketNumber: number;
  status: string;
  source: string;
  employeeName: string;
  question: string;
  sendError: string | null;
  createdAt: string;
  hrPair: { id: string; name: string } | null;
  assignee: { id: string; name: string | null } | null;
  dueAt: string | null;
}

/**
 * The filter chips. APPROVED is absent on purpose: it is the seconds-long
 * "sending" claim, and a chip that is almost always empty is a dead control.
 * A row caught in it still shows, labelled "Sending", under "All".
 */
const STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_APPROVAL",
  "SENT",
  "SEND_FAILED",
  "CLOSED",
] as const;

interface QueuePage {
  data: QueueRow[];
  nextCursor: string | null;
  counts: Record<string, number>;
  pairs?: { id: string; name: string }[];
  settings: { ticketPrefix: string; statusLabels: Record<string, string> };
}

interface Filters {
  pairId: string | null;
  source: string | null;
  from: string;
  to: string;
  q: string;
}

const NO_FILTERS: Filters = { pairId: null, source: null, from: "", to: "", q: "" };

/** The Select's "any" option. Radix reserves the empty string. */

/** Typing pause before a search runs: one request per thought, not per key. */
const SEARCH_DEBOUNCE_MS = 300;

export default function EscalationQueuePage() {
  const t = useTranslations("hive.escalations");
  const sourceLabel = useSourceLabels();
  const locale = useLocale();
  const [status, setStatus] = useState<string | null>(null);
  // UX P1 (tickets P1-2): All / Mine / Unassigned / Overdue.
  const [view, setView] = useState<string>("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [seen, setSeen] = useState<QueueRow[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [search, setSearch] = useState("");
  // The pair list arrives with the first page; kept so "show older" (which
  // does not resend it) does not empty the control.
  const [pairs, setPairs] = useState<{ id: string; name: string }[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Spec V2 §8.8 Settings, from the API so a rename shows on the next load.
  const [settings, setSettings] = useState<QueuePage["settings"] | null>(null);
  const statusLabel = useStatusLabels(settings?.statusLabels);

  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((f) => (f.q === search.trim() ? f : { ...f, q: search.trim() }));
      setCursor(null);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);

  const query = useQuery<QueuePage>({
    queryKey: ["hive", "escalations", status, cursor, filters, view],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (cursor) params.set("cursor", cursor);
      if (filters.pairId) params.set("pairId", filters.pairId);
      if (filters.source) params.set("source", filters.source);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.q) params.set("q", filters.q);
      if (view) params.set("view", view);
      const suffix = params.toString() ? `?${params}` : "";
      const page = await apiClient.get<QueuePage>(`/api/hive/escalations${suffix}`);
      if (page.pairs) setPairs(page.pairs);
      setSettings(page.settings);
      if (!cursor) setCounts(page.counts);
      setSeen((prev) => {
        // A filter change replaces; a "show older" appends. Deduped on id
        // because React Query can re-run this and a repeated row reads as two
        // employees asking the same thing.
        const base = cursor ? prev : [];
        const already = new Set(base.map((r) => r.id));
        return [...base, ...page.data.filter((r) => !already.has(r.id))];
      });
      return page;
    },
  });

  function filterBy(next: string | null) {
    setStatus(next);
    setCursor(null);
  }

  function narrow(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setCursor(null);
  }

  function clearFilters() {
    setFilters(NO_FILTERS);
    setSearch("");
    setCursor(null);
  }

  const filtered =
    filters.pairId !== null ||
    filters.source !== null ||
    filters.from !== "" ||
    filters.to !== "" ||
    search.trim() !== "";
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);

  const when = (iso: string) => formatDay(iso);

  const columns = [
    {
      key: "ticket",
      title: t("ticket"),
      render: (_: unknown, row: QueueRow) => (
        <div className="flex flex-col items-start gap-1">
          <Link
            href={`/${locale}/tickets/${row.id}`}
            className="font-mono text-xs whitespace-nowrap text-primary-emphasis underline-offset-4 hover:underline"
          >
            {formatTicketId(row.ticketNumber, settings?.ticketPrefix)}
          </Link>
          <StatusPill status={row.status} label={statusLabel[row.status] ?? row.status} />
        </div>
      ),
    },
    {
      key: "employee",
      title: t("employee"),
      render: (_: unknown, row: QueueRow) => (
        <div className="min-w-0">
          <div className="whitespace-nowrap text-foreground">{row.employeeName}</div>
          {/* Truncated in the LIST only; the full question is on the ticket. */}
          <div className="max-w-[40ch] truncate text-xs text-muted-foreground">{row.question}</div>
        </div>
      ),
    },
    {
      key: "pair",
      title: t("pair"),
      render: (_: unknown, row: QueueRow) => (
        <div className="text-sm whitespace-nowrap">
          {row.hrPair?.name ?? "—"}
          <div className="text-xs text-muted-foreground">
            {row.assignee?.name ?? t("unassigned")}
          </div>
        </div>
      ),
    },
    {
      key: "due",
      title: t("due"),
      render: (_: unknown, row: QueueRow) => (
        <div className="flex flex-col items-start gap-1 text-xs whitespace-nowrap">
          <AgeingBadge dueAt={row.dueAt} status={row.status} />
          <span className="text-muted-foreground">
            {t("raisedOn", { date: when(row.createdAt) })} · {sourceLabel[row.source] ?? row.source}
          </span>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("intro")} />

      <div className="mb-4">
        <FilterChips
          label={t("viewLabel")}
          value={view}
          onChange={(v) => {
            setView(v);
            setCursor(null);
          }}
          chips={[
            { value: "", label: t("viewAll") },
            { value: "mine", label: t("viewMine") },
            { value: "unassigned", label: t("viewUnassigned") },
            { value: "overdue", label: t("viewOverdue") },
          ]}
        />
      </div>

      <FilterBar className="mb-4">
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <Label htmlFor="queue-search" className="text-xs text-muted-foreground">
            {t("searchLabel")}
          </Label>
          <Input
            id="queue-search"
            type="search"
            className="h-9"
            value={search}
            placeholder={t("searchPlaceholder")}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FilterSelect
          id="queue-pair"
          label={t("pair")}
          allLabel={t("anyPair")}
          value={filters.pairId ?? ""}
          onChange={(v) => narrow({ pairId: v || null })}
          options={pairs.map((p) => ({ value: p.id, label: p.name }))}
        />
        <FilterSelect
          id="queue-source"
          label={t("source")}
          allLabel={t("anySource")}
          value={filters.source ?? ""}
          onChange={(v) => narrow({ source: v || null })}
          options={(["SIRAAJ", "HIVE"] as const).map((s) => ({ value: s, label: sourceLabel[s] }))}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="queue-from" className="text-xs text-muted-foreground">
            {t("from")}
          </Label>
          <Input
            id="queue-from"
            type="date"
            className="h-9 w-40"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => narrow({ from: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="queue-to" className="text-xs text-muted-foreground">
            {t("to")}
          </Label>
          <Input
            id="queue-to"
            type="date"
            className="h-9 w-40"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => narrow({ to: e.target.value })}
          />
        </div>
        {filtered ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {t("clearFilters")}
          </Button>
        ) : null}
      </FilterBar>

      <div className="mb-4">
        <FilterChips
          label={t("statusColumn")}
          value={status ?? ""}
          onChange={(v) => filterBy(v || null)}
          chips={[
            { value: "", label: t("filterAll"), count: allCount },
            ...STATUSES.map((s) => ({ value: s, label: statusLabel[s], count: counts[s] ?? 0 })),
          ]}
        />
      </div>

      {query.isError ? (
        <EmptyState description={t("loadFailed")} />
      ) : (
        <DataTable<QueueRow>
          rowKey="id"
          columns={columns}
          dataSource={seen}
          loading={query.isPending && seen.length === 0}
          emptyText={
            <EmptyState description={filtered || status || view ? t("noMatch") : t("empty")} />
          }
        />
      )}

      {query.data?.nextCursor ? (
        <div className="mt-4">
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => setCursor(query.data?.nextCursor ?? null)}
          >
            {query.isFetching ? t("loading") : t("loadMore")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

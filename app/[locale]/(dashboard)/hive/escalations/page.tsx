"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
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
const ANY = "ANY";

/** Typing pause before a search runs: one request per thought, not per key. */
const SEARCH_DEBOUNCE_MS = 300;

export default function EscalationQueuePage() {
  const t = useTranslations("hive.escalations");
  const sourceLabel = useSourceLabels();
  const locale = useLocale();
  const [status, setStatus] = useState<string | null>(null);
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
    queryKey: ["hive", "escalations", status, cursor, filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (cursor) params.set("cursor", cursor);
      if (filters.pairId) params.set("pairId", filters.pairId);
      if (filters.source) params.set("source", filters.source);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.q) params.set("q", filters.q);
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

  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("intro")} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <Label htmlFor="queue-search">{t("searchLabel")}</Label>
          <Input
            id="queue-search"
            type="search"
            value={search}
            placeholder={t("searchPlaceholder")}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label id="queue-pair-label">{t("pair")}</Label>
          <Select
            value={filters.pairId ?? ANY}
            onValueChange={(v) => narrow({ pairId: v === ANY ? null : v })}
          >
            <SelectTrigger aria-labelledby="queue-pair-label" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("anyPair")}</SelectItem>
              {pairs.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label id="queue-source-label">{t("source")}</Label>
          <Select
            value={filters.source ?? ANY}
            onValueChange={(v) => narrow({ source: v === ANY ? null : v })}
          >
            <SelectTrigger aria-labelledby="queue-source-label" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("anySource")}</SelectItem>
              {(["SIRAAJ", "HIVE"] as const).map((s) => (
                <SelectItem key={s} value={s}>
                  {sourceLabel[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="queue-from">{t("from")}</Label>
          <Input
            id="queue-from"
            type="date"
            className="w-40"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => narrow({ from: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="queue-to">{t("to")}</Label>
          <Input
            id="queue-to"
            type="date"
            className="w-40"
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
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t("statusColumn")}>
        <Button
          variant={status === null ? "default" : "outline"}
          size="sm"
          onClick={() => filterBy(null)}
        >
          {t("chip", { label: t("filterAll"), count: allCount })}
        </Button>
        {STATUSES.map((s) => (
          <Button
            key={s}
            variant={status === s ? "default" : "outline"}
            size="sm"
            onClick={() => filterBy(s)}
          >
            {t("chip", { label: statusLabel[s], count: counts[s] ?? 0 })}
          </Button>
        ))}
      </div>

      {query.isError ? (
        <EmptyState description={t("loadFailed")} />
      ) : query.isPending && seen.length === 0 ? (
        <EmptyState description={t("loading")} />
      ) : seen.length === 0 ? (
        <EmptyState description={filtered || status ? t("noMatch") : t("empty")} />
      ) : (
        // The card is titled with the ACTIVE FILTER, not with the page's own name.
        // Repeating "Escalations" as a card heading directly under the page
        // heading is a line that carries no information and pushes the table
        // down; the filter is the thing a reader actually needs restated,
        // because the chip row scrolls out of view on a long queue.
        <SectionCard title={status ? statusLabel[status] : t("filterAll")} noBodyPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-4 py-2 text-start font-medium">{t("ticket")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("statusColumn")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("employee")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("question")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("pair")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("source")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("raised")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("open")}</th>
                </tr>
              </thead>
              <tbody>
                {seen.map((row) => (
                  <tr key={row.id} className="border-b border-border align-top">
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground">
                      {formatTicketId(row.ticketNumber, settings?.ticketPrefix)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill
                        status={row.status}
                        label={statusLabel[row.status] ?? row.status}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-foreground">
                      {row.employeeName}
                    </td>
                    {/* Truncated in the LIST only. The full text is on the detail
                        page — a queue that wraps four-line questions is one nobody
                        scans. */}
                    <td className="max-w-[38ch] truncate px-4 py-3 text-foreground">
                      {row.question}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {row.hrPair?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {sourceLabel[row.source] ?? row.source}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {when(row.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/${locale}/hive/escalations/${row.id}`}
                        // `primary-emphasis`, not `primary`. The raw brand royal
                        // is ~3:1 on a dark surface — axe flags it serious, and
                        // OQ-5 named the pastel palette as a real contrast risk
                        // rather than a formality. This token exists for brand
                        // used AS TEXT and lifts on dark; `bg-primary` buttons
                        // keep the brand colour.
                        className="text-primary-emphasis underline underline-offset-4"
                      >
                        {t("open")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
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

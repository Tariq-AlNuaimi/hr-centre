"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PersonPicker, type Person } from "@/components/hiring/ui/person-picker";
import { useNotify } from "@/hooks/use-notify";
import { ApiError, apiClient } from "@/lib/api-client";
import type { WorkList } from "@/lib/core/work-items";
import { formatDate } from "@/lib/format";

type Delegation = {
  id: string;
  delegatorId: string;
  delegateId: string;
  module: string | null;
  validFrom: string;
  validUntil: string;
  reason: string | null;
  delegator: { name: string | null; email: string };
  delegate: { name: string | null; email: string };
};

/**
 * The Approvals inbox (ADR-094): the decisions in "My work" — offers,
 * requisitions, JD sign-offs, joiner and leaver approvals, ticket answers —
 * on one page, plus "decide my approvals while I'm away".
 */
export function ApprovalsInbox() {
  const t = useTranslations("approvals");
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Waiting />
      <Delegations />
    </div>
  );
}

function Waiting() {
  const t = useTranslations("approvals");
  const tw = useTranslations("work");
  const locale = useLocale();
  const q = useQuery({
    queryKey: ["work-items"],
    queryFn: () => apiClient.get<WorkList>("/api/work-items"),
  });
  const items = (q.data?.items ?? []).filter((i) => i.approval);
  return (
    <SectionCard title={t("waiting")} subtitle={t("waitingNote")}>
      {q.isLoading ? (
        <TableSkeleton rows={3} />
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("loadFailed")}
        </p>
      ) : (
        <>
          {(q.data?.failed ?? []).length > 0 ? (
            <p role="status" className="mb-3 text-sm text-muted-foreground">
              {t("partial", {
                modules: (q.data?.failed ?? []).map((m) => tw(`module.${m}`)).join(", "),
              })}
            </p>
          ) : null}
          {items.length === 0 ? (
            <EmptyState description={t("none")} />
          ) : (
            <ul>
              {items.map((item) => (
                <li
                  key={item.key}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant="brand">{tw(`module.${item.module}`)}</Badge>
                    <span className="text-sm font-medium text-foreground">
                      {tw(`kind.${item.kind}`, item.params)}
                    </span>
                  </div>
                  <Link
                    href={`/${locale}${item.href}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    {tw("open")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </SectionCard>
  );
}

function Delegations() {
  const td = useTranslations("approvals.delegation");
  const client = useQueryClient();
  const { success, error } = useNotify();
  const q = useQuery({
    queryKey: ["approval-delegations"],
    queryFn: () => apiClient.get<Delegation[]>("/api/approvals/delegations"),
  });
  const [delegate, setDelegate] = useState<Person | null>(null);
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      success(done);
      await client.invalidateQueries({ queryKey: ["approval-delegations"] });
      return true;
    } catch (e) {
      error(e instanceof ApiError ? e.message : td("failed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title={td("title")} subtitle={td("note")}>
      {q.isLoading ? (
        <TableSkeleton rows={2} />
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {td("loadFailed")}
        </p>
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState description={td("none")} />
      ) : (
        <ul className="mb-4">
          {(q.data ?? []).map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-b-0"
            >
              <span className="text-sm text-foreground">
                {td("row", {
                  from: d.delegator.name ?? d.delegator.email,
                  to: d.delegate.name ?? d.delegate.email,
                  start: formatDate(d.validFrom),
                  end: formatDate(d.validUntil),
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => apiClient.delete(`/api/approvals/delegations/${d.id}`),
                    td("ended"),
                  )
                }
              >
                {td("end")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!delegate) return;
          void act(
            () =>
              apiClient.post("/api/approvals/delegations", {
                delegateId: delegate.id,
                module: "hiring",
                validFrom: from,
                validUntil: until,
                reason: reason || undefined,
              }),
            td("saved"),
          ).then((saved) => {
            if (saved) {
              setDelegate(null);
              setReason("");
            }
          });
        }}
      >
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor="delegate-person" className="block text-sm font-medium text-foreground">
            {td("delegate")}
          </label>
          <PersonPicker
            id="delegate-person"
            value={delegate}
            onChange={setDelegate}
            permission="hiring.view"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="delegate-from" className="block text-sm font-medium text-foreground">
            {td("from")}
          </label>
          <Input
            id="delegate-from"
            type="date"
            required
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="delegate-until" className="block text-sm font-medium text-foreground">
            {td("until")}
          </label>
          <Input
            id="delegate-until"
            type="date"
            required
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor="delegate-reason" className="block text-sm font-medium text-foreground">
            {td("reason")}
          </label>
          <Input
            id="delegate-reason"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy || !delegate || !from || !until}>
            {td("save")}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

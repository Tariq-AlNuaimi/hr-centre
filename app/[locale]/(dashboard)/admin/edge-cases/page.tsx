"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button-variants";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LeaverRecorder } from "@/components/pms/LeaverRecorder";
import { TransferRecorder } from "@/components/pms/TransferRecorder";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { DataTable } from "@/components/shared/DataTable";
import { StatCard } from "@/components/shared/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CyclePicker } from "@/components/pms/CyclePicker";
import { useCycleSelection } from "@/hooks/use-cycle-selection";
import { usePmsActor } from "@/hooks/use-pms-actor";
import { apiClient } from "@/lib/api-client";

/**
 * §12 — the three edge cases, on HR's desk.
 *
 * §12.2 is the reason this screen exists at all: "HR gets a VISIBLE PROMPT for
 * temporary roll-ups … so they don't silently persist." A prompt with nowhere to
 * live is a prompt that gets dismissed once and forgotten, so the roll-up queue
 * leads the page and stays until someone decides.
 *
 * Below it, the two other §12 registers:
 *
 *   - §12.1's 360 reassignment queue — assignments whose rater has left and who
 *     therefore cannot finish, with the ratee named because §9.4 says they
 *     "must still reach 3 assessments";
 *   - §12.3's transfer register — who was split, at what date, and what weight
 *     each half carries.
 *
 * Recording a departure or a transfer happens on the person's own record and
 * through the import (§12.1 allows both); this screen is where the CONSEQUENCES
 * are worked, which is the part §12 says must not be silent.
 */

interface RollUpsResponse {
  promptKey: string;
  openCount: number;
  rollUps: Array<{
    id: string;
    reason: string;
    createdAt: string;
    openDays: number | null;
    resolvedAt: string | null;
    employeeId: string;
    employeeName: string;
    employeeNumber: string;
    department: string | null;
    fromManager: { id: string; name: string } | null;
    toManager: { id: string; name: string } | null;
  }>;
}

interface ReassignmentsResponse {
  reassignments: Array<{
    assignmentId: string;
    status: string;
    raterName: string;
    raterLastWorkingDay: string | null;
    rateeId: string;
    rateeName: string;
    threeSixtyStatus: string;
  }>;
}

interface TransfersResponse {
  cycleId: string;
  periods: Array<{
    id: string;
    orderIndex: number;
    employeeId: string;
    employeeName: string;
    employeeNumber: string;
    department: string | null;
    entity: string;
    manager: { id: string; name: string } | null;
    startsOn: string;
    endsOn: string;
    days: number;
    weight: string;
    kpiCount: number;
  }>;
}

export default function EdgeCasesPage() {
  const t = useTranslations("pms.edgeCases");
  const locale = useLocale();
  const { capabilities, isLoading: actorLoading } = usePmsActor();
  const { cycles, cycleList, cycleId, selectedCycleId, setSelectedCycleId } = useCycleSelection();

  const rollUps = useQuery({
    queryKey: ["pms", "roll-ups"],
    queryFn: () => apiClient.get<RollUpsResponse>("/api/roll-ups"),
    enabled: capabilities.orgWide,
  });

  const reassignments = useQuery({
    queryKey: ["pms", "leavers"],
    queryFn: () => apiClient.get<ReassignmentsResponse>("/api/leavers"),
    enabled: capabilities.orgWide,
  });

  const transfers = useQuery({
    queryKey: ["pms", "transfers", cycleId],
    queryFn: () => apiClient.get<TransfersResponse>(`/api/transfers?cycleId=${cycleId}`),
    enabled: capabilities.orgWide && cycleId !== null,
  });

  if (actorLoading || cycles.isLoading) return <PageSkeleton />;

  if (!capabilities.orgWide) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <SectionCard title={t("notPermitted")}>
          <EmptyState description={t("notPermittedHelp")} />
        </SectionCard>
      </div>
    );
  }

  const open = rollUps.data?.rollUps.filter((r) => r.resolvedAt === null) ?? [];
  const reassignmentRows = reassignments.data?.reassignments ?? [];
  const periods = transfers.data?.periods ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <CyclePicker
            cycles={cycleList}
            value={selectedCycleId ?? cycleId}
            onChange={setSelectedCycleId}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title={t("openRollUps")} value={open.length} hint={t("openRollUpsHint")} />
        <StatCard
          title={t("reassignmentsNeeded")}
          value={reassignmentRows.length}
          hint={t("reassignmentsHint")}
        />
        <StatCard
          title={t("splitYears")}
          value={new Set(periods.map((p) => p.employeeId)).size}
          hint={t("splitYearsHint")}
        />
      </div>

      {/* UX review P0 (docs/blueprints/ux-p0.md, US-2): a leaver or a move is a
          Joiners & leavers case — checklist, approvals, settlement, access — and
          closing it applies everything this page tracks. This page no longer
          records them; it watches their Performance consequences. */}
      <SectionCard title={t("startTitle")} subtitle={t("startHelp")}>
        <div className="flex flex-wrap gap-2">
          <Link href={`/${locale}/jml/leavers/new`} className={buttonVariants({ size: "sm" })}>
            {t("startLeaver")}
          </Link>
          <Link
            href={`/${locale}/jml/movers/new`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("startMover")}
          </Link>
        </div>
      </SectionCard>

      {/* The correction path (import mistakes, historical leavers): HR Super
          Admin only, with a reason the server writes to the audit log. */}
      {capabilities.configure ? (
        <details className="rounded-md border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">{t("correctionsTitle")}</summary>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">{t("correctionsHelp")}</p>
          <div className="mt-4 space-y-4">
            <LeaverRecorder onDone={() => void rollUps.refetch()} />
            {cycleId && (
              <TransferRecorder cycleId={cycleId} onDone={() => void transfers.refetch()} />
            )}
          </div>
        </details>
      ) : null}

      <SectionCard title={t("rollUpsTitle")} subtitle={t("rollUpsHelp")}>
        {open.length === 0 ? (
          <EmptyState description={t("noRollUps")} />
        ) : (
          <ul className="space-y-2">
            {open.map((rollUp) => (
              <RollUpRow key={rollUp.id} rollUp={rollUp} />
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={t("reassignmentsTitle")} subtitle={t("reassignmentsHelp")} noBodyPadding>
        {reassignmentRows.length === 0 ? (
          <div className="p-6">
            <EmptyState description={t("noReassignments")} />
          </div>
        ) : (
          <DataTable<ReassignmentsResponse["reassignments"][number]>
            rowKey="assignmentId"
            dataSource={reassignmentRows}
            total={reassignmentRows.length}
            page={1}
            pageSize={reassignmentRows.length}
            columns={[
              { key: "rateeName", title: t("ratee"), dataIndex: "rateeName" },
              { key: "raterName", title: t("departedRater"), dataIndex: "raterName" },
              {
                key: "status",
                title: t("assignmentStatus"),
                render: (_v: unknown, row: ReassignmentsResponse["reassignments"][number]) => (
                  <Badge variant="warning">{row.status}</Badge>
                ),
              },
            ]}
          />
        )}
      </SectionCard>

      <SectionCard title={t("transfersTitle")} subtitle={t("transfersHelp")} noBodyPadding>
        {periods.length === 0 ? (
          <div className="p-6">
            <EmptyState description={t("noTransfers")} />
          </div>
        ) : (
          <DataTable<TransfersResponse["periods"][number]>
            rowKey="id"
            dataSource={periods}
            total={periods.length}
            page={1}
            pageSize={periods.length}
            columns={[
              {
                key: "employeeName",
                title: t("employee"),
                render: (_v: unknown, row: TransfersResponse["periods"][number]) => (
                  <div>
                    <div className="font-medium">{row.employeeName}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("period", { index: row.orderIndex + 1 })} · {row.department ?? row.entity}
                    </div>
                  </div>
                ),
              },
              {
                key: "window",
                title: t("window"),
                render: (_v: unknown, row: TransfersResponse["periods"][number]) =>
                  `${new Date(row.startsOn).toLocaleDateString()} – ${new Date(
                    row.endsOn,
                  ).toLocaleDateString()}`,
              },
              {
                key: "weight",
                title: t("weight"),
                // §12.3's "days-in-department ÷ 365", shown as both so the
                // arithmetic is checkable rather than trusted.
                render: (_v: unknown, row: TransfersResponse["periods"][number]) => (
                  <span>
                    {row.weight}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({t("days", { days: row.days })})
                    </span>
                  </span>
                ),
              },
              {
                key: "manager",
                title: t("periodManager"),
                render: (_v: unknown, row: TransfersResponse["periods"][number]) =>
                  row.manager?.name ?? "—",
              },
              { key: "kpiCount", title: t("kpis"), dataIndex: "kpiCount" },
            ]}
          />
        )}
      </SectionCard>
    </div>
  );
}

/** One open §12.2 prompt, with HR's decision attached. */
function RollUpRow({ rollUp }: { rollUp: RollUpsResponse["rollUps"][number] }) {
  const t = useTranslations("pms.edgeCases");
  const queryClient = useQueryClient();
  const [managerId, setManagerId] = useState("");
  const [note, setNote] = useState("");

  const resolve = useMutation({
    mutationFn: (confirmCurrent: boolean) =>
      apiClient.post("/api/roll-ups", {
        rollUpId: rollUp.id,
        ...(confirmCurrent ? {} : { newManagerEmployeeId: managerId.trim() }),
        ...(note.trim() ? { resolutionNote: note.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success(t("resolved", { name: rollUp.employeeName }));
      void queryClient.invalidateQueries({ queryKey: ["pms", "roll-ups"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <li className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-medium">{rollUp.employeeName}</div>
          <div className="text-xs text-muted-foreground">
            {rollUp.department ?? "—"} · {rollUp.employeeNumber}
          </div>
        </div>
        {/* How long this has been open — the fact that turns a queue into
            something someone acts on. */}
        <Badge variant={(rollUp.openDays ?? 0) > 14 ? "danger" : "warning"}>
          {t("openFor", { days: rollUp.openDays ?? 0 })}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">
        {rollUp.toManager
          ? t("rolledUpTo", {
              from: rollUp.fromManager?.name ?? "—",
              to: rollUp.toManager.name,
            })
          : /* Null target: nobody above the departed manager. The most urgent
               case, and it says so rather than showing a blank. */
            t("unmanaged", { from: rollUp.fromManager?.name ?? "—" })}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Label htmlFor={`manager-${rollUp.id}`} className="text-xs">
            {t("permanentManager")}
          </Label>
          <Input
            id={`manager-${rollUp.id}`}
            value={managerId}
            onChange={(event) => setManagerId(event.target.value)}
            placeholder={t("managerPlaceholder")}
          />
        </div>
        <div className="min-w-48 flex-1">
          <Label htmlFor={`note-${rollUp.id}`} className="text-xs">
            {t("note")}
          </Label>
          <Input
            id={`note-${rollUp.id}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <Button
          size="sm"
          disabled={managerId.trim() === "" || resolve.isPending}
          onClick={() => resolve.mutate(false)}
        >
          {t("assignAction")}
        </Button>
        {/* Confirming the roll-up AS permanent is a real decision, distinct from
            leaving the prompt open — §12.2 wants it made, not defaulted into. */}
        <Button
          size="sm"
          variant="outline"
          disabled={!rollUp.toManager || resolve.isPending}
          onClick={() => resolve.mutate(true)}
        >
          {t("confirmCurrentAction")}
        </Button>
      </div>
    </li>
  );
}

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { Field } from "../Field";
import { LoadFailed, LoadingBlock } from "../States";
import { useJmlAction } from "../use-jml";

type Gate = {
  gateId: string;
  label: string;
  dataProblem: string | null;
  record: {
    satisfied: boolean;
    satisfiedAt: string | null;
    reference: string | null;
    overriddenById: string | null;
    overrideReason: string | null;
    overriddenAt: string | null;
    satisfiedBy: { name: string | null } | null;
    overriddenBy: { name: string | null } | null;
  } | null;
};
type Listing = {
  gates: Gate[];
  closure: { allowed: boolean; outstanding: Array<{ gateId: string; label: string }> };
  incidents: Array<{
    id: string;
    kind: string;
    gateId: string;
    deadlineAt: string;
    daysLate: number;
    resolvedAt: string | null;
    note: string | null;
  }>;
  can: { record: boolean; override: boolean };
};

/** C1–C11 (§17.3), recorded or overridden by hand; the incidents the daily scan logged (F16). */
export function ComplianceTab({ caseId, status }: { caseId: string; status: string }) {
  const t = useTranslations("jml.leavers.compliance");
  const q = useQuery({
    queryKey: ["jml", "exit", caseId, "gates"],
    queryFn: () => apiClient.get<Listing>(`/api/jml/leavers/${caseId}/gates`),
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !q.data) return <LoadFailed />;
  const d = q.data;
  const active = !["DRAFT", "CLOSED", "CANCELLED", "ARCHIVED"].includes(status);
  return (
    <div className="space-y-4">
      <p
        role="status"
        className={
          d.closure.allowed
            ? "rounded-md bg-status-ok p-3 text-sm text-status-ok-fg"
            : "rounded-md bg-status-warn p-3 text-sm text-status-warn-fg"
        }
      >
        {d.closure.allowed
          ? t("allClear")
          : t("outstanding", { count: d.closure.outstanding.length })}
      </p>
      <ul className="space-y-2">
        {d.gates.map((g) => (
          <li
            key={g.gateId}
            className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-3 text-sm"
          >
            <div className="space-y-1">
              <p className="font-medium">{t("gateLine", { id: g.gateId, label: g.label })}</p>
              <p className="text-xs text-muted-foreground">
                {g.record?.overriddenById
                  ? t("overridden", {
                      by: g.record.overriddenBy?.name ?? "—",
                      reason: g.record.overrideReason ?? "",
                    })
                  : g.record?.satisfied
                    ? t("satisfied", {
                        by: g.record.satisfiedBy?.name ?? "—",
                        date: g.record.satisfiedAt?.slice(0, 10) ?? "",
                        ref: g.record.reference ?? "",
                      })
                    : t("notYet")}
              </p>
              {g.dataProblem && !g.record?.satisfied && !g.record?.overriddenById ? (
                <p className="text-xs text-status-warn-fg">{g.dataProblem}</p>
              ) : null}
            </div>
            {active ? (
              <div className="flex gap-2">
                {d.can.record ? <GateDialog caseId={caseId} gate={g} mode="record" /> : null}
                {d.can.override ? <GateDialog caseId={caseId} gate={g} mode="override" /> : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <SectionCard title={t("incidentsTitle")} subtitle={t("incidentsNote")}>
        {d.incidents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noIncidents")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {d.incidents.map((i) => (
              <li key={i.id}>
                {t("incidentLine", {
                  gate: i.gateId,
                  note: i.note ?? i.kind,
                  deadline: i.deadlineAt.slice(0, 10),
                  days: i.daysLate,
                })}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function GateDialog({
  caseId,
  gate,
  mode,
}: {
  caseId: string;
  gate: Gate;
  mode: "record" | "override";
}) {
  const t = useTranslations("jml.leavers.compliance");
  const { run, busy } = useJmlAction(t("failed"));
  const [satisfied, setSatisfied] = useState(gate.record?.satisfied ?? true);
  const [reference, setReference] = useState(gate.record?.reference ?? "");
  const [reason, setReason] = useState("");
  const override = mode === "override";
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="outline">
          {override ? t("override") : t("record")}
        </Button>
      }
      title={t(override ? "overrideTitle" : "recordTitle", { id: gate.gateId })}
      description={override ? t("overrideBody") : gate.label}
      confirmLabel={override ? t("override") : t("record")}
      destructive={override}
      busy={busy}
      disabled={override && reason.trim().length < 3}
      onConfirm={async () =>
        Boolean(
          await run(
            () =>
              apiClient.put(`/api/jml/leavers/${caseId}/gates`, {
                gateId: gate.gateId,
                ...(override ? { override: true, overrideReason: reason.trim() } : { satisfied }),
                reference: reference.trim() || null,
              }),
            t("saved"),
          ),
        )
      }
    >
      {!override ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={satisfied}
            onChange={(e) => setSatisfied(e.target.checked)}
          />
          {t("isSatisfied")}
        </label>
      ) : (
        <Field id={`gate-reason-${gate.gateId}`} label={t("reason")}>
          <Input
            id={`gate-reason-${gate.gateId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      )}
      <Field id={`gate-ref-${gate.gateId}`} label={t("reference")}>
        <Input
          id={`gate-ref-${gate.gateId}`}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </Field>
    </ActionDialog>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, Plus, ShieldCheck, XCircle } from "lucide-react";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";
import { Badge } from "@/components/ui/badge";

/**
 * The dry-run review surface — spec §3.4 / §3.5.
 *
 * This component IS the safety property. §3.5 says a missing row changes
 * nothing and Appendix A calls it an invariant ("silence is never destructive"),
 * but an invariant nobody can see is one HR has to take on trust. So the absent
 * list is rendered as prominently as the creates and updates, labelled with what
 * will happen to those people: nothing.
 */

export type PreviewIssue = {
  rowNumber: number;
  odooId: string | null;
  field: string | null;
  rule: string;
  message: string;
  severity: "REJECT" | "WARNING";
};

export type PreviewCreate = {
  rowNumber: number;
  odooId: string;
  name: string;
  email: string;
  departmentName: string | null;
  entityCode: string;
  roleTrack: string;
  status: string;
};

export type PreviewUpdate = {
  rowNumber: number;
  odooId: string;
  employeeId: string;
  name: string;
  changes: Array<{ field: string; from: string | null; to: string | null }>;
};

export type PreviewAbsent = { employeeId: string; odooId: string; name: string };

export type ImportPreviewData = {
  filename: string;
  rowsTotal: number;
  creates: PreviewCreate[];
  updates: PreviewUpdate[];
  absent: PreviewAbsent[];
  issues: PreviewIssue[];
};

/** Cap what is listed so a 5,000-row import does not render 5,000 <li>s. */
const MAX_LISTED = 50;

export function ImportPreview({ preview }: { preview: ImportPreviewData }) {
  const t = useTranslations("pms");

  const rejects = preview.issues.filter((i) => i.severity === "REJECT");
  const warnings = preview.issues.filter((i) => i.severity === "WARNING");
  const rejectedRows = new Set(rejects.map((i) => i.rowNumber)).size;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("import.willCreate")} value={preview.creates.length} icon={<Plus />} />
        <StatCard
          title={t("import.willUpdate")}
          value={preview.updates.length}
          icon={<ArrowRight />}
        />
        <StatCard title={t("import.rejected")} value={rejectedRows} icon={<XCircle />} />
        {/* §3.5 — given equal billing on purpose. */}
        <StatCard
          title={t("import.untouched")}
          value={preview.absent.length}
          icon={<ShieldCheck />}
        />
      </div>

      {rejects.length > 0 ? (
        <SectionCard title={t("import.rejectedTitle")} subtitle={t("import.rejectedNote")}>
          <ul className="space-y-2">
            {rejects.slice(0, MAX_LISTED).map((issue, i) => (
              <li key={`${issue.rowNumber}-${issue.rule}-${i}`} className="flex gap-3 text-sm">
                <Badge variant="danger">
                  {t("import.row")} {issue.rowNumber}
                </Badge>
                <span className="text-foreground">{issue.message}</span>
              </li>
            ))}
          </ul>
          {rejects.length > MAX_LISTED ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {t("import.andMore", { count: rejects.length - MAX_LISTED })}
            </p>
          ) : null}
        </SectionCard>
      ) : null}

      {warnings.length > 0 ? (
        <SectionCard title={t("import.warningsTitle")} subtitle={t("import.warningsNote")}>
          <ul className="space-y-2">
            {warnings.slice(0, MAX_LISTED).map((issue, i) => (
              <li key={`${issue.rowNumber}-${issue.rule}-${i}`} className="flex gap-3 text-sm">
                <Badge variant="warning">
                  <AlertTriangle className="me-1 h-3 w-3" />
                  {t("import.row")} {issue.rowNumber}
                </Badge>
                <span className="text-foreground">{issue.message}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {preview.creates.length > 0 ? (
        <SectionCard title={t("import.createsTitle")}>
          <ul className="space-y-1 text-sm">
            {preview.creates.slice(0, MAX_LISTED).map((create) => (
              <li key={create.odooId} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{create.odooId}</span>
                <span className="font-medium text-foreground">{create.name}</span>
                <span className="text-xs text-muted-foreground">
                  {create.entityCode}
                  {create.departmentName ? ` · ${create.departmentName}` : ""}
                </span>
                <Badge variant="default">{t(`track.${create.roleTrack}`)}</Badge>
              </li>
            ))}
          </ul>
          {preview.creates.length > MAX_LISTED ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {t("import.andMore", { count: preview.creates.length - MAX_LISTED })}
            </p>
          ) : null}
        </SectionCard>
      ) : null}

      {preview.updates.length > 0 ? (
        <SectionCard title={t("import.updatesTitle")} subtitle={t("import.updatesNote")}>
          <ul className="space-y-3 text-sm">
            {preview.updates.slice(0, MAX_LISTED).map((update) => (
              <li key={update.odooId}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{update.odooId}</span>
                  <span className="font-medium text-foreground">{update.name}</span>
                </div>
                <ul className="ms-4 mt-1 list-none space-y-0.5">
                  {update.changes.map((change) => (
                    <li key={change.field} className="text-xs text-muted-foreground">
                      <span className="text-foreground">{change.field}</span>:{" "}
                      {/* Restricted fields arrive already redacted from the
                          reconciler — the figures never reach this component. */}
                      <span className="line-through">{change.from ?? "—"}</span>{" "}
                      <ArrowRight className="inline h-3 w-3" /> <span>{change.to ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {/*
        §3.5 / Appendix A — "Absence from a file is never interpreted as a
        departure." Shown even when the list is long, because the whole reason
        this screen exists is so a truncated export is visible as a truncated
        export rather than as a wave of departures.
      */}
      {preview.absent.length > 0 ? (
        <SectionCard title={t("import.absentTitle")} subtitle={t("import.absentNote")}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {preview.absent.slice(0, MAX_LISTED).map((absent) => (
              <li key={absent.employeeId}>
                <span className="font-mono text-xs">{absent.odooId}</span> {absent.name}
              </li>
            ))}
          </ul>
          {preview.absent.length > MAX_LISTED ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {t("import.andMore", { count: preview.absent.length - MAX_LISTED })}
            </p>
          ) : null}
        </SectionCard>
      ) : null}
    </div>
  );
}

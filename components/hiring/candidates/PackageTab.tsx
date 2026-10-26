"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Ban, Check, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { DataTable } from "@/components/shared/DataTable";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatMoney } from "@/lib/hiring/money";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { Notice, QueryState } from "../ui/states";
import { DeclineDialog, UploadDocumentDialog } from "./PackageDialogs";

type Doc = {
  id: string;
  label: string;
  fromCandidate: boolean;
  statedAmount: number | null;
  currency: string;
  reviewedAt: string | null;
  hasFile: boolean;
  uploadedBy: { name: string } | null;
  reviewedBy: { name: string } | null;
};
type Pkg = {
  compVisible: boolean;
  status: string;
  basis: "BAND_AND_VERDICT" | "BAND_VERDICT_AND_EVIDENCE";
  reviewedPayslips: number;
  payslipsRequested: number;
  confirmedBy: { name: string } | null;
  declinedReason: string | null;
  currentPackage: number | null;
  expectation: number | null;
  band: { min: number | null; max: number | null };
  midpoint: number | null;
};

/**
 * Package confirmation, step 9 (Interview Hub `PackageConfirmation`): the pay-
 * slip evidence trail and the decision to confirm, or to record that the
 * candidate declined to share. Current pay is context, never the anchor.
 */
export function PackageTab({ candidateId }: { candidateId: string }) {
  const t = useTranslations("hiring.package");
  const base = `/api/hiring/candidates/${candidateId}`;
  const docs = useHiringQuery<Doc[]>(`${base}/documents`);
  const pkg = useHiringQuery<Pkg>(`${base}/package`);
  const [uploading, setUploading] = useState(false);
  const [declining, setDeclining] = useState(false);
  const act = useHiringMutation<{ action: string }>("POST", `${base}/package`, {
    success: t("recorded"),
  });
  const review = useHiringMutation<{ docId: string; reviewed: boolean }>(
    "PATCH",
    (b) => `${base}/documents/${b.docId}`,
  );
  const remove = useHiringMutation<{ docId: string }>(
    "DELETE",
    (b) => `${base}/documents/${b.docId}`,
    {
      success: t("removed"),
    },
  );
  const p = pkg.data;
  const declined = p?.status === "DECLINED";

  const columns = docColumns({
    t,
    base,
    compVisible: Boolean(p?.compVisible),
    onReview: (docId, reviewed) => review.mutate({ docId, reviewed }),
    onRemove: (docId) => remove.mutate({ docId }),
  });

  return (
    <QueryState
      isLoading={pkg.isLoading || docs.isLoading}
      error={pkg.error ?? docs.error}
      onRetry={() => void pkg.refetch()}
    >
      {p ? (
        <div className="space-y-4">
          {declined ? (
            <Notice tone="info" title={t("declinedTitle")}>
              <p>{t("declinedBody")}</p>
              {p.declinedReason ? <p className="mt-2 italic">“{p.declinedReason}”</p> : null}
            </Notice>
          ) : null}
          <SectionCard
            title={t("evidenceTitle")}
            actions={
              <span className="text-xs text-muted-foreground">
                {t("monthsRead", { read: p.reviewedPayslips, of: p.payslipsRequested })}
              </span>
            }
          >
            {(docs.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {declined ? t("noDocsDeclined") : t("noDocs", { count: p.payslipsRequested })}
              </p>
            ) : (
              <DataTable<Doc> rowKey="id" columns={columns} dataSource={docs.data ?? []} />
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setUploading(true)}>
                <Upload className="h-4 w-4" />
                {t("upload")}
              </Button>
              {declined ? (
                <Button
                  variant="outline"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ action: "reopen" })}
                >
                  {t("reopen")}
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ action: "request" })}
                  >
                    {t("requestAnother")}
                  </Button>
                  <Button variant="outline" onClick={() => setDeclining(true)}>
                    <Ban className="h-4 w-4" />
                    {t("candidateDeclined")}
                  </Button>
                </>
              )}
              {p.status === "CONFIRMED" ? (
                <Badge variant="success">
                  {p.confirmedBy ? t("confirmedBy", { name: p.confirmedBy.name }) : t("confirmed")}
                </Badge>
              ) : (
                <Button disabled={act.isPending} onClick={() => act.mutate({ action: "confirm" })}>
                  <Check className="h-4 w-4" />
                  {t("confirm")}
                </Button>
              )}
            </div>
          </SectionCard>
          <ContextCard p={p} />
          <UploadDocumentDialog
            open={uploading}
            onOpenChange={setUploading}
            candidateId={candidateId}
            showAmount={p.compVisible}
          />
          <DeclineDialog open={declining} onOpenChange={setDeclining} candidateId={candidateId} />
        </div>
      ) : null}
    </QueryState>
  );
}

function ContextCard({ p }: { p: Pkg }) {
  const t = useTranslations("hiring.package");
  return (
    <SectionCard title={t("contextTitle")}>
      <Notice
        tone="info"
        title={p.basis === "BAND_AND_VERDICT" ? t("basisBand") : t("basisEvidence")}
      >
        {t("contextNote")}
      </Notice>
      <div className="mt-4">
        {p.compVisible ? (
          <DescriptionList
            columns={2}
            items={[
              {
                key: "cur",
                label: t("currentPackage"),
                value:
                  p.currentPackage == null ? t("notEstablished") : formatMoney(p.currentPackage),
              },
              { key: "exp", label: t("expectation"), value: formatMoney(p.expectation) },
              {
                key: "band",
                label: t("band"),
                value:
                  p.band.min == null || p.band.max == null
                    ? "—"
                    : `${formatMoney(p.band.min)} – ${formatMoney(p.band.max)}`,
              },
              { key: "mid", label: t("midpoint"), value: formatMoney(p.midpoint) },
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t("figuresHidden")}</p>
        )}
      </div>
    </SectionCard>
  );
}

type T = ReturnType<typeof useTranslations<"hiring.package">>;

function docColumns({
  t,
  base,
  compVisible,
  onReview,
  onRemove,
}: {
  t: T;
  base: string;
  compVisible: boolean;
  onReview: (docId: string, reviewed: boolean) => void;
  onRemove: (docId: string) => void;
}) {
  return [
    {
      title: t("colDocument"),
      key: "label",
      render: (_: unknown, d: Doc) => (
        <div>
          {d.hasFile && compVisible ? (
            <a
              href={`${base}/documents/${d.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary-emphasis hover:underline"
            >
              {d.label}
            </a>
          ) : (
            <span className="font-medium">{d.label}</span>
          )}
          <p className="text-xs text-muted-foreground">
            {d.fromCandidate
              ? t("fromCandidate")
              : t("uploadedBy", { name: d.uploadedBy?.name ?? "—" })}
            {d.reviewedBy ? ` · ${t("readBy", { name: d.reviewedBy.name })}` : ""}
          </p>
        </div>
      ),
    },
    {
      title: t("colAmount"),
      key: "amt",
      render: (_: unknown, d: Doc) => formatMoney(d.statedAmount, d.currency),
    },
    {
      title: t("colReview"),
      key: "rev",
      render: (_: unknown, d: Doc) =>
        d.reviewedAt ? (
          <span className="flex items-center gap-2">
            <Badge variant="success">{t("reviewed")}</Badge>
            {compVisible ? (
              <Button size="sm" variant="link" onClick={() => onReview(d.id, false)}>
                {t("undo")}
              </Button>
            ) : null}
          </span>
        ) : compVisible ? (
          <Button size="sm" variant="outline" onClick={() => onReview(d.id, true)}>
            <Check className="h-4 w-4" />
            {t("markRead")}
          </Button>
        ) : (
          <Badge>{t("notRead")}</Badge>
        ),
    },
    ...(compVisible
      ? [
          {
            title: "",
            key: "rm",
            align: "right" as const,
            render: (_: unknown, d: Doc) => (
              <ConfirmAction
                title={t("removeTitle")}
                description={t("removeBody")}
                okText={t("remove")}
                okType="danger"
                onConfirm={() => onRemove(d.id)}
              >
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("removeNamed", { name: d.label })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </ConfirmAction>
            ),
          },
        ]
      : []),
  ];
}

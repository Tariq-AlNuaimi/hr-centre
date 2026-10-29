"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNotify } from "@/hooks/use-notify";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { downloadFile } from "../download";
import { Field } from "@/components/shared/FormControls";
import { LoadFailed, LoadingBlock } from "../States";

type Listing = {
  generated: Array<{
    id: string;
    documentType: string;
    templateVersion: number;
    currentVersionReason: string | null;
    generatedAt: string;
    generatedBy: { name: string | null } | null;
    template: { name: string; isDefault: boolean };
  }>;
  active: Array<{ documentType: string; name: string; version: number; isDefault: boolean }>;
  can: { generate: boolean };
};

/** §16 documents: generate from the active template; regenerate pinned (or current, with a reason). Nothing is stored. */
export function DocumentsTab({ caseId, status }: { caseId: string; status: string }) {
  const t = useTranslations("jml.leavers.documents");
  const td = useTranslations("jml.documentType");
  const q = useQuery({
    queryKey: ["jml", "exit", caseId, "documents"],
    queryFn: () => apiClient.get<Listing>(`/api/jml/leavers/${caseId}/documents`),
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !q.data) return <LoadFailed />;
  const d = q.data;
  if (status === "DRAFT") return <p className="text-sm text-muted-foreground">{t("draft")}</p>;
  return (
    <div className="space-y-6">
      <SectionCard title={t("title")} subtitle={t("subtitle")}>
        {d.active.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noTemplates")}</p>
        ) : (
          <ul className="space-y-2">
            {d.active.map((a) => {
              const before = d.generated.some((g) => g.documentType === a.documentType);
              return (
                <li
                  key={a.documentType}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{td(a.documentType)}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {a.isDefault
                        ? t("defaultTemplate", { version: a.version })
                        : t("version", { version: a.version })}
                    </span>
                  </span>
                  {d.can.generate ? (
                    <GenerateButtons caseId={caseId} type={a.documentType} again={before} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
      <SectionCard title={t("historyTitle")}>
        {d.generated.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {d.generated.map((g) => (
              <li key={g.id}>
                {t("historyLine", {
                  type: td(g.documentType),
                  version: g.templateVersion,
                  by: g.generatedBy?.name ?? "—",
                  at: g.generatedAt.slice(0, 16).replace("T", " "),
                })}
                {g.currentVersionReason ? ` — ${g.currentVersionReason}` : ""}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function GenerateButtons({
  caseId,
  type,
  again,
}: {
  caseId: string;
  type: string;
  again: boolean;
}) {
  const t = useTranslations("jml.leavers.documents");
  const { success, error } = useNotify();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const go = async (useCurrent: boolean) => {
    setBusy(true);
    const problem = await downloadFile(`/api/jml/leavers/${caseId}/documents`, `${type}.docx`, {
      documentType: type,
      useCurrent,
      reason: useCurrent ? reason.trim() : null,
    });
    setBusy(false);
    if (problem) {
      error(problem);
      return false;
    }
    success(t("generated"));
    await queryClient.invalidateQueries({ queryKey: ["jml", "exit", caseId, "documents"] });
    return true;
  };
  return (
    <span className="flex gap-2">
      <Button size="sm" disabled={busy} onClick={() => void go(false)}>
        {again ? t("regenerate") : t("generate")}
      </Button>
      {again ? (
        <ActionDialog
          trigger={
            <Button size="sm" variant="outline">
              {t("useCurrent")}
            </Button>
          }
          title={t("useCurrentTitle")}
          description={t("useCurrentBody")}
          confirmLabel={t("generate")}
          busy={busy}
          disabled={reason.trim().length < 3}
          onConfirm={() => go(true)}
        >
          <Field id={`doc-reason-${type}`} label={t("reason")}>
            <Input
              id={`doc-reason-${type}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </ActionDialog>
      ) : null}
    </span>
  );
}

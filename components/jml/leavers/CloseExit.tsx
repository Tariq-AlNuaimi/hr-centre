"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { useJmlAction } from "../use-jml";

/** Close an exit (API-only in the source — F6): shows what still blocks it, honestly. */
export function CloseExit({ caseId, version }: { caseId: string; version: number }) {
  const t = useTranslations("jml.leavers.close");
  const { run, busy } = useJmlAction(t("failed"));
  const preview = useQuery({
    queryKey: ["jml", "exit", caseId, "close"],
    queryFn: () => apiClient.get<{ problems: string[] }>(`/api/jml/leavers/${caseId}/close`),
  });
  const problems = preview.data?.problems ?? [];
  return (
    <ActionDialog
      trigger={
        <Button variant="outline" size="sm">
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={problems.length ? t("blocked") : t("body")}
      confirmLabel={t("confirm")}
      busy={busy}
      disabled={preview.isLoading || problems.length > 0}
      onConfirm={async () =>
        Boolean(
          await run(
            () => apiClient.post(`/api/jml/leavers/${caseId}/close`, { expectedVersion: version }),
            t("done"),
          ),
        )
      }
    >
      {problems.length ? (
        <ul className="list-disc space-y-1 ps-5 text-sm text-status-warn-fg">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </ActionDialog>
  );
}

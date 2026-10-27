"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { Field } from "../Field";
import { LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";

type Outcome = {
  fatal: string | null;
  toCreate: number;
  skipped: number;
  problems: Array<{ line: number; caseRef: string | null; message: string }>;
  committed: boolean;
};

/** Historical exits (§26.2): check the file first; importing is a second, deliberate press. */
export function ImportExitsSettings() {
  const t = useTranslations("jml.settings.importExits");
  const { can, isLoading } = useJmlAccess();
  const { run, busy } = useJmlAction(t("failed"));
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<Outcome | null>(null);
  if (isLoading) return <LoadingBlock />;
  if (!can("jml.configure")) return <NotPermitted title={t("title")} />;
  const send = async (commit: boolean) => {
    const r = await run(
      () => apiClient.post<Outcome>("/api/jml/config/import-exits", { csv, commit }),
      commit ? t("imported") : undefined,
    );
    if (r) setResult(r);
  };
  const clean = result && !result.fatal && result.problems.length === 0;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SectionCard title={t("fileTitle")} subtitle={t("columns")}>
        <Field id="imp-file" label={t("file")}>
          <Input
            id="imp-file"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setResult(null);
              setCsv(f ? await f.text() : "");
            }}
          />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" disabled={busy || !csv} onClick={() => void send(false)}>
            {t("check")}
          </Button>
          <Button
            disabled={busy || !clean || result!.toCreate === 0 || result!.committed}
            onClick={() => void send(true)}
          >
            {t("import")}
          </Button>
        </div>
      </SectionCard>
      {result ? (
        <SectionCard title={result.committed ? t("doneTitle") : t("checkTitle")}>
          {result.fatal ? (
            <p role="status" className="text-sm text-status-warn-fg">
              {result.fatal}
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              <p>
                {t("counts", {
                  create: result.toCreate,
                  skip: result.skipped,
                  problems: result.problems.length,
                })}
              </p>
              <ul className="list-disc space-y-1 ps-5 text-status-warn-fg">
                {result.problems.map((p) => (
                  <li key={`${p.line}-${p.message}`}>
                    {t("problem", { line: p.line, ref: p.caseRef ?? "—", message: p.message })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>
      ) : null}
    </div>
  );
}

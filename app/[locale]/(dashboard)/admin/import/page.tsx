"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button, buttonVariants } from "@/components/ui/button";
import { ImportPreview, type ImportPreviewData } from "@/components/pms/ImportPreview";
import { usePmsActor } from "@/hooks/use-pms-actor";
import { useNotify } from "@/hooks/use-notify";

/**
 * Employee import — spec §3. Form/wizard archetype, in two explicit steps.
 *
 * Step 1 uploads and gets a DRY RUN. Step 2 confirms it. Nothing is written
 * between them, which is what makes §3.5's "missing rows change nothing"
 * something HR can verify rather than trust.
 *
 * The chosen File is held in state between the two steps because the confirm
 * call re-submits it: the parsed rows carry Restricted salary and are
 * deliberately not persisted server-side (see lib/pms/import/run.ts). That also
 * means a page refresh loses the preview — correct, since a stale plan is
 * exactly what the counts check exists to reject.
 */
export default function ImportPage() {
  const t = useTranslations("pms");
  const router = useRouter();
  const locale = useLocale();
  const { capabilities, isLoading: actorLoading } = usePmsActor();
  const { success, warning, error: showError } = useNotify();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewData | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

  async function handlePreview() {
    if (!file) return;
    setBusy("preview");
    setFileError(null);
    setPreview(null);
    setBatchId(null);

    try {
      const body = new FormData();
      body.append("file", file);
      // Plain fetch, not apiClient: this is multipart, and apiClient sets a JSON
      // content-type that would strip the multipart boundary.
      const response = await fetch("/api/imports", { method: "POST", body });
      const json = (await response.json()) as {
        data?: { batchId: string; preview: ImportPreviewData };
        error?: string;
      };

      if (!response.ok || !json.data) {
        // A file-level problem is the operator's to fix and its message is
        // written for them — shown in place, not as a toast that scrolls away
        // while they are looking at the sheet.
        setFileError(json.error ?? t("import.previewFailed"));
        return;
      }

      setBatchId(json.data.batchId);
      setPreview(json.data.preview);
    } catch {
      setFileError(t("import.previewFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleApply() {
    if (!file || !batchId) return;
    setBusy("apply");
    setFileError(null);

    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/imports/${batchId}/apply`, { method: "POST", body });
      const json = (await response.json()) as {
        data?: {
          created: number;
          updated: number;
          provisioned: number;
          returningWithRevokedLogin: number;
          participantsEnrolled: number;
          participantsPending: number;
          enrolmentFailed: boolean;
        };
        error?: string;
      };

      if (!response.ok || !json.data) {
        setFileError(json.error ?? t("import.applyFailed"));
        return;
      }

      // `provisioned` is reported separately from `created`, because they are
      // legitimately different numbers: a leaver gets no login (§12.1 preserves
      // the record, not the access) and an email that already has one is left
      // alone. HR is told what happened, not what was attempted (ADR-069).
      success(
        t("import.applied", {
          created: json.data.created,
          updated: json.data.updated,
          provisioned: json.data.provisioned,
        }),
      );

      // §3.5 — the import PULLS NEW PEOPLE INTO THE CYCLE, and saying so is the
      // point: enrolment used to happen only when a cycle opened, so employees
      // imported afterwards never became participants and their manager found
      // goal-setting empty with no explanation. Now it happens, and HR sees
      // that it happened rather than having to go and check.
      if (json.data.participantsEnrolled > 0) {
        success(t("import.enrolled", { count: json.data.participantsEnrolled }));
      }
      // A bounded enrolment that did not finish must say so, or the operator
      // reads "47 enrolled" as "everyone", and the people still missing are
      // exactly the ones this whole fix exists for.
      if (json.data.participantsPending > 0) {
        warning(t("import.enrolmentPending", { count: json.data.participantsPending }));
      }
      // The import committed; only the follow-on enrolment did not. Saying so
      // precisely matters — the remedy is the cycle button, NOT re-uploading
      // the file, which would only earn a 409 on a spent batch.
      if (json.data.enrolmentFailed) {
        warning(t("import.enrolmentFailed"));
      }

      // ADR-069 — a returning employee reconciles as an UPDATE, so provisioning
      // never runs for them and the account off-boarding revoked stays revoked.
      // The import deliberately does not un-delete it (a revoked account may have
      // been revoked for cause), but it must not be SILENT about it either: this
      // person is locked out of both sign-in paths, and the remedy is a restore
      // from the recycling bin that nobody will perform if nobody is told.
      if (json.data.returningWithRevokedLogin > 0) {
        warning(t("import.returningRevoked", { count: json.data.returningWithRevokedLogin }));
      }
      setPreview(null);
      setBatchId(null);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.push(`/${locale}/people`);
    } catch {
      showError(t("import.applyFailed"));
    } finally {
      setBusy(null);
    }
  }

  if (actorLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("import.title")} />
        <SectionCard title={t("import.uploadStep")}>
          <div className="h-24 animate-pulse rounded-md bg-muted" />
        </SectionCard>
      </div>
    );
  }

  if (!capabilities.previewImport) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("import.title")} />
        <SectionCard title={t("import.uploadStep")}>
          <EmptyState description={t("import.notPermitted")} />
        </SectionCard>
      </div>
    );
  }

  const rejectedRows = preview
    ? new Set(preview.issues.filter((i) => i.severity === "REJECT").map((i) => i.rowNumber)).size
    : 0;
  const nothingToApply =
    preview !== null && preview.creates.length === 0 && preview.updates.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("import.title")}
        subtitle={t("import.subtitle")}
        // A real anchor, not a Button with an onClick: the target responds with
        // Content-Disposition: attachment, and only a genuine navigation
        // triggers the browser's download handling. A router.push() would be a
        // client-side transition that downloads nothing.
        actions={
          <a
            href="/api/imports/template"
            download
            className={buttonVariants({ variant: "outline" })}
          >
            <Download className="me-2 h-4 w-4" />
            {t("import.downloadTemplate")}
          </a>
        }
      />

      <SectionCard title={t("import.uploadStep")} subtitle={t("import.uploadNote")}>
        <div className="space-y-4">
          <div>
            <label htmlFor="import-file" className="mb-1 block text-sm font-medium text-foreground">
              {t("import.fileLabel")}
            </label>
            <input
              id="import-file"
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setBatchId(null);
                setFileError(null);
              }}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground file:me-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {fileError ? (
            <p role="alert" className="text-sm text-destructive-emphasis">
              {fileError}
            </p>
          ) : null}

          <Button onClick={handlePreview} disabled={!file || busy !== null}>
            <Upload className="me-2 h-4 w-4" />
            {busy === "preview" ? t("import.checking") : t("import.checkFile")}
          </Button>
        </div>
      </SectionCard>

      {preview ? (
        <>
          <ImportPreview preview={preview} />

          <SectionCard title={t("import.confirmStep")} subtitle={t("import.confirmNote")}>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleApply} disabled={busy !== null || nothingToApply}>
                {busy === "apply"
                  ? t("import.applying")
                  : t("import.applyAction", {
                      created: preview.creates.length,
                      updated: preview.updates.length,
                    })}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPreview(null);
                  setBatchId(null);
                }}
                disabled={busy !== null}
              >
                {t("import.discard")}
              </Button>
            </div>

            {nothingToApply ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("import.nothingToApply")}</p>
            ) : null}

            {rejectedRows > 0 ? (
              // Rejected rows do NOT block the rest of the file — §3.4 rejects
              // the ROW, not the import. Saying so prevents HR from assuming a
              // partial apply is a failure and re-uploading needlessly.
              <p className="mt-3 text-sm text-muted-foreground">
                {t("import.rejectedWillBeSkipped", { count: rejectedRows })}
              </p>
            ) : null}
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}

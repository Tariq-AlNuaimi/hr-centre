"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { useNotify } from "@/hooks/use-notify";
import { apiClient } from "@/lib/api-client";
import { downloadFile } from "../download";
import { Field } from "../Field";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";

const TYPES = [
  "ACCEPTANCE_OF_RESIGNATION",
  "TERMINATION_NOTIFICATION",
  "NON_RENEWAL_NOTIFICATION",
  "BANK_TERMINATION_NOTICE",
  "REPATRIATION_TICKET_REQUEST",
  "IT_ACCESS_REVOCATION_INSTRUCTION",
  "FINAL_SETTLEMENT_WORKSHEET",
  "SETTLEMENT_TRANSMITTAL_TO_FINANCE",
  "CERTIFICATE_OF_SERVICE",
] as const;

type Template = {
  id: string;
  documentType: string;
  name: string;
  version: number;
  state: string;
  isDefault: boolean;
  approvedAt: string | null;
  createdAt: string;
  uploadedBy: { name: string | null } | null;
  approvedBy: { name: string | null } | null;
};
type Listing = { templates: Template[]; can: { upload: boolean; activate: boolean } };

/** Document templates (ADR-083): upload a .docx (draft), an HR Manager activates it, the previous one retires. */
export function DocumentsSettings() {
  const t = useTranslations("jml.settings.documents");
  const { can, isLoading } = useJmlAccess();
  const q = useQuery({
    queryKey: ["jml", "document-templates"],
    queryFn: () => apiClient.get<Listing>("/api/jml/config/documents"),
    enabled: can("jml.configure"),
  });
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  if (isLoading || q.isLoading)
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  if (!can("jml.configure")) return <NotPermitted title={t("title")} />;
  if (q.isError || !q.data)
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed />
      </div>
    );
  const d = q.data;
  return (
    <div className="space-y-6">
      {header}
      {d.can.upload ? <UploadCard /> : null}
      {TYPES.map((type) => (
        <TypeCard
          key={type}
          type={type}
          rows={d.templates.filter((x) => x.documentType === type)}
          canActivate={d.can.activate}
        />
      ))}
    </div>
  );
}

function TypeCard({
  type,
  rows,
  canActivate,
}: {
  type: string;
  rows: Template[];
  canActivate: boolean;
}) {
  const t = useTranslations("jml.settings.documents");
  const td = useTranslations("jml.documentType");
  const { error } = useNotify();
  const { run, busy } = useJmlAction(t("failed"));
  return (
    <SectionCard title={td(type)}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noVersions")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span>
                {t("versionLine", { version: r.version, name: r.name })}{" "}
                <span className="text-xs text-muted-foreground">
                  {r.isDefault
                    ? t("isDefault")
                    : t("uploadedBy", { who: r.uploadedBy?.name ?? "—" })}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge variant={r.state === "ACTIVE" ? "default" : "outline"}>
                  {t(`state.${r.state}`)}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const p = await downloadFile(
                      `/api/jml/config/documents/${r.id}/file`,
                      `${type}-v${r.version}.docx`,
                    );
                    if (p) error(p);
                  }}
                >
                  {t("download")}
                </Button>
                {canActivate && r.state === "DRAFT" ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => apiClient.post(`/api/jml/config/documents/${r.id}/activate`),
                        t("activated"),
                      )
                    }
                  >
                    {t("activate")}
                  </Button>
                ) : null}
                {canActivate && r.state === "ACTIVE" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => apiClient.post(`/api/jml/config/documents/${r.id}/retire`),
                        t("retired"),
                      )
                    }
                  >
                    {t("retire")}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function UploadCard() {
  const t = useTranslations("jml.settings.documents");
  const td = useTranslations("jml.documentType");
  const { run, busy } = useJmlAction(t("failed"));
  const [type, setType] = useState<string>(TYPES[0]);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const upload = async () => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const ok = await run(
      () =>
        apiClient.post("/api/jml/config/documents", {
          documentType: type,
          name: name.trim(),
          base64: btoa(binary),
        }),
      t("uploaded"),
    );
    if (ok) {
      setName("");
      setFile(null);
    }
  };
  return (
    <SectionCard title={t("uploadTitle")} subtitle={t("uploadNote")}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="doc-type" label={t("type")}>
          <NativeSelect
            id="doc-type"
            className="w-full"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {TYPES.map((x) => (
              <option key={x} value={x}>
                {td(x)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="doc-name" label={t("name")}>
          <Input id="doc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="doc-file" label={t("file")}>
          <Input
            id="doc-file"
            type="file"
            accept=".docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button disabled={busy || !file || name.trim().length < 2} onClick={() => void upload()}>
          {t("upload")}
        </Button>
      </div>
    </SectionCard>
  );
}

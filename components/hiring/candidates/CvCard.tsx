"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/SectionCard";
import type { CandidateDetail } from "./types";

/**
 * The CV (Interview Hub Documents tab): open it (a short-lived signed link,
 * new tab) or upload / replace it (PDF ≤ 10 MB). When file storage is not
 * configured the server says so and the message is shown as given.
 */
export function CvCard({ c }: { c: CandidateDetail }) {
  const t = useTranslations("hiring.candidate");
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const contact = c.contact;
  if (!contact)
    return (
      <SectionCard title={t("cvTitle")}>
        <p className="text-sm text-muted-foreground">{t("piiHidden")}</p>
      </SectionCard>
    );

  async function upload(file: File) {
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/hiring/candidates/${c.id}/cv`, { method: "POST", body });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(e?.error ?? t("uploadFailed"));
      }
      toast.success(t("cvUploaded"));
      void qc.invalidateQueries({ queryKey: ["hiring"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <SectionCard title={t("cvTitle")}>
      {contact.hasCv ? (
        <a
          href={`/api/hiring/candidates/${c.id}/cv`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary-emphasis hover:underline"
        >
          <FileText aria-hidden className="h-4 w-4" />
          {contact.cvFileName ?? t("viewCv")}
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">{t("noCv")}</p>
      )}
      {c.can.manage ? (
        <div className="mt-3">
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            id="cv-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            <Upload className="h-4 w-4" />
            {contact.hasCv ? t("replaceCv") : t("uploadCv")}
          </Button>
        </div>
      ) : null}
    </SectionCard>
  );
}

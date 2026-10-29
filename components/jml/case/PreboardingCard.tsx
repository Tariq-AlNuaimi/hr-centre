"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SectionCard } from "@/components/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNotify } from "@/hooks/use-notify";
import { ApiError, apiClient } from "@/lib/api-client";
import { PREBOARDING_DOCUMENTS } from "@/lib/jml/preboarding/rules";
import { useJmlAccess } from "../use-jml";

/**
 * P2-4 — the joiner's preboarding, from HR's side: issue or revoke the link,
 * see what the joiner wrote, their documents answers, and the picture.
 */

type Status = {
  blockedReason: string | null;
  linkLive: boolean;
  linkIssuedAt: string | null;
  linkExpiresAt: string | null;
  submittedAt: string | null;
  introSentence: string | null;
  hobbies: string | null;
  documents: Record<string, string>;
  photoUploadedAt: string | null;
  remindersSent: number;
  canEmail: boolean;
  storageConfigured: boolean;
};

export function PreboardingCard({ caseId }: { caseId: string }) {
  const t = useTranslations("jml.preboarding.hr");
  const tp = useTranslations("jml.preboarding.public");
  const { can } = useJmlAccess();
  const { success, error } = useNotify();
  const queryClient = useQueryClient();
  const [link, setLink] = useState<string | null>(null);
  const key = ["jml", "preboarding", caseId];

  const status = useQuery({
    queryKey: key,
    queryFn: () => apiClient.get<Status>(`/api/jml/cases/${caseId}/preboarding`),
  });

  const issue = useMutation({
    mutationFn: (email: boolean) =>
      apiClient.post<{ path: string; url: string | null; emailed: boolean }>(
        `/api/jml/cases/${caseId}/preboarding`,
        { email },
      ),
    onSuccess: (r) => {
      setLink(r.url ?? `${window.location.origin}${r.path}`);
      success(r.emailed ? t("emailed") : t("issued"));
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => error(e instanceof ApiError ? e.message : t("failed")),
  });

  const revoke = useMutation({
    mutationFn: () => apiClient.delete(`/api/jml/cases/${caseId}/preboarding`),
    onSuccess: () => {
      setLink(null);
      success(t("revoked"));
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => error(e instanceof ApiError ? e.message : t("failed")),
  });

  async function openPhoto() {
    try {
      const r = await apiClient.get<{ url: string }>(`/api/jml/cases/${caseId}/preboarding/photo`);
      window.open(r.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      error(e instanceof ApiError ? e.message : t("failed"));
    }
  }

  if (status.isLoading) {
    return (
      <SectionCard title={t("title")}>
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </SectionCard>
    );
  }
  if (status.isError || !status.data) {
    return (
      <SectionCard title={t("title")}>
        <p className="text-sm text-muted-foreground">{t("loadFailed")}</p>
      </SectionCard>
    );
  }
  const s = status.data;
  const manage = can("jml.manageJoiners") && s.blockedReason === null;

  return (
    <SectionCard
      title={t("title")}
      subtitle={t("subtitle")}
      actions={
        s.submittedAt ? (
          <Badge variant="success">{t("submitted", { when: s.submittedAt.slice(0, 10) })}</Badge>
        ) : s.linkLive ? (
          <Badge variant="outline">{t("waiting")}</Badge>
        ) : null
      }
    >
      <div className="space-y-4 text-sm">
        {s.blockedReason && <p className="text-muted-foreground">{s.blockedReason}</p>}
        {s.linkLive && s.linkExpiresAt && (
          <p className="text-muted-foreground">
            {t("linkLive", {
              until: s.linkExpiresAt.slice(0, 10),
              count: s.remindersSent,
            })}
          </p>
        )}
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={issue.isPending} onClick={() => issue.mutate(false)}>
              {s.linkLive ? t("newLink") : t("createLink")}
            </Button>
            {s.canEmail && (
              <Button
                size="sm"
                variant="outline"
                disabled={issue.isPending}
                onClick={() => issue.mutate(true)}
              >
                {t("emailLink")}
              </Button>
            )}
            {s.linkLive && (
              <Button
                size="sm"
                variant="outline"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate()}
              >
                {t("revoke")}
              </Button>
            )}
          </div>
        )}
        {link && (
          <div className="space-y-1">
            <label htmlFor={`pb-link-${caseId}`} className="text-xs text-muted-foreground">
              {t("copyHelp")}
            </label>
            <Input
              id={`pb-link-${caseId}`}
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
            />
          </div>
        )}
        {s.submittedAt && (
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">{tp("introLabel")}</dt>
              <dd className="m-0">{s.introSentence ?? t("blank")}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{tp("hobbiesLabel")}</dt>
              <dd className="m-0">{s.hobbies ?? t("blank")}</dd>
            </div>
            {PREBOARDING_DOCUMENTS.map((doc) => (
              <div key={doc}>
                <dt className="text-xs text-muted-foreground">{tp(`document.${doc}`)}</dt>
                <dd className="m-0">
                  {s.documents[doc] ? tp(`answer.${s.documents[doc]}`) : t("blank")}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{tp("photoTitle")}:</span>
          {s.photoUploadedAt ? (
            <Button
              size="sm"
              variant="link"
              className="h-auto p-0"
              onClick={() => void openPhoto()}
            >
              {t("viewPhoto")}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {s.storageConfigured ? t("noPhoto") : t("noStorage")}
            </span>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

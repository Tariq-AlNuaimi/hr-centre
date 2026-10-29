"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { CaseStatusBadge } from "../CaseBits";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction, useJmlLookups } from "../use-jml";
import { ActivationPanel } from "./ActivationPanel";
import { CandidateSection, PlacementSection, type JoinerValues } from "./JoinerFields";
import { EmploymentSection, IntroSection, ItSection, PaySection } from "./JoinerMoreFields";
import { BLANK, payloadOf, valuesOf, type JoinerDto } from "./joiner-values";

/**
 * Add / edit a joiner — Onboarding `NewHireForm` + `ActivationPanel`. A draft
 * saves with a name, company and department; activation reports every missing
 * field at once. After activation every field stays editable except the planned
 * start, which moves through the case's "Change start date".
 */
export function JoinerForm({ caseId }: { caseId?: string }) {
  const t = useTranslations("jml.joiners");
  const { can, isLoading } = useJmlAccess();
  const router = useRouter();
  const lookups = useJmlLookups(can("jml.view"));
  const joiner = useQuery({
    queryKey: ["jml", "joiner", caseId],
    queryFn: () => apiClient.get<JoinerDto>(`/api/jml/joiners/${caseId}`),
    enabled: Boolean(caseId),
  });
  if (isLoading || lookups.isLoading || (caseId && joiner.isLoading)) return <LoadingBlock />;
  if (!can("jml.manageJoiners")) return <NotPermitted title={t("title")} />;
  if (lookups.isError || !lookups.data || (caseId && (joiner.isError || !joiner.data))) {
    return <LoadFailed />;
  }
  return (
    <Editor
      key={joiner.data?.version ?? "new"}
      dto={joiner.data ?? null}
      lookups={lookups.data}
      salaryAllowed={joiner.data ? joiner.data.salaryVisible : can("people.viewSalary")}
      onCreated={(id) => router.push(`/jml/joiners/${id}`)}
    />
  );
}

function Editor({
  dto,
  lookups,
  salaryAllowed,
  onCreated,
}: {
  dto: JoinerDto | null;
  lookups: NonNullable<ReturnType<typeof useJmlLookups>["data"]>;
  salaryAllowed: boolean;
  onCreated: (caseId: string) => void;
}) {
  const t = useTranslations("jml.joiners");
  const router = useRouter();
  const initial = dto ? valuesOf(dto) : null;
  const [v, setV] = useState<JoinerValues>(initial ?? BLANK);
  const { run, busy } = useJmlAction(t("saveFailed"));
  const set = <K extends keyof JoinerValues>(key: K, value: JoinerValues[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));
  const isDraft = !dto || dto.status === "DRAFT";
  const closed = dto?.status === "CANCELLED" || dto?.status === "ARCHIVED";

  async function save() {
    const payload = payloadOf(v, initial, salaryAllowed);
    if (dto) {
      await run(
        () =>
          apiClient.patch(`/api/jml/joiners/${dto.caseId}`, {
            ...payload,
            expectedVersion: dto.version,
          }),
        t("saved"),
      );
    } else {
      const created = await run(
        () => apiClient.post<JoinerDto>("/api/jml/joiners", payload),
        t("draftSaved"),
      );
      if (created) onCreated(created.caseId);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={dto ? dto.fullName : t("newTitle")}
        subtitle={dto ? (dto.caseRef ?? t("draftLabel")) : t("newSubtitle")}
        actions={
          <div className="flex items-center gap-2">
            {dto ? <CaseStatusBadge status={dto.status} /> : null}
            {dto && !isDraft ? (
              <Link
                href={`/jml/cases/${dto.caseId}`}
                className="text-sm text-primary hover:underline"
              >
                {t("openCase")}
              </Link>
            ) : null}
          </div>
        }
      />
      {/* QA2 N-19 — the "complete and activate" hint is for the draft only. */}
      {dto?.sourceRef && isDraft ? (
        <p className="text-sm text-muted-foreground">{t("fromHiring")}</p>
      ) : null}
      <CandidateSection v={v} set={set} />
      <PlacementSection v={v} set={set} lookups={lookups} />
      <EmploymentSection v={v} set={set} lookups={lookups} startLocked={!isDraft} />
      <PaySection v={v} set={set} salaryAllowed={salaryAllowed} />
      <ItSection v={v} set={set} />
      <IntroSection v={v} set={set} />
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button
          onClick={() => void save()}
          disabled={busy || closed || !v.fullName.trim() || !v.entityId}
        >
          {dto ? t("saveChanges") : t("saveDraft")}
        </Button>
        {dto && isDraft ? (
          <ActionDialog
            trigger={
              <Button variant="outline" disabled={busy}>
                {t("discard")}
              </Button>
            }
            title={t("discardTitle")}
            description={t("discardBody")}
            confirmLabel={t("discard")}
            destructive
            busy={busy}
            onConfirm={async () => {
              const done = await run(
                () => apiClient.delete(`/api/jml/joiners/${dto.caseId}`),
                t("discarded"),
              );
              if (done) router.push("/jml/joiners");
              return Boolean(done);
            }}
          />
        ) : null}
      </div>
      {dto && isDraft ? <ActivationPanel caseId={dto.caseId} /> : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Lock, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KPI_LEVEL_FIELDS, KpiForm, type KpiFormValues } from "@/components/pms/KpiForm";
import { StageBanner, type GoalStage } from "@/components/pms/StageBanner";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

/**
 * KPI drafting for ONE participant — spec §5.1, §5.2, §5.3, §5.4, §8.3.
 *
 * The server component above supplies the KPI set and the three gates that
 * decide what this screen may do; this island owns the writes. Five spec
 * decisions are load-bearing here, and each is a thing the screen deliberately
 * does NOT do:
 *
 *   1. **No reject button** (§5.3 — "the unsigned state is the signal"). There
 *      is no un-sign, no decline, no rejection reason. What the screen owes
 *      instead is a LEGIBLE unsigned state, so "not signed yet" is stated for
 *      each party rather than left as an absence the reader has to notice.
 *   2. **The weightage total never blocks a save** (§5.3 is checked at
 *      sign-off). A draft may sit at 80% for a week. The gap is shown; the save
 *      is not refused.
 *   3. **`weightageComplete` decides, not the number.** `weightageTotal` is a
 *      decimal STRING precisely so nobody re-sums it as a float and disagrees
 *      with the server about 99.99 vs 100. It is displayed, never parsed.
 *   4. **A refusal is quoted, not paraphrased.** Every write can come back 409
 *      with `editBlockedReason` (§4.2 not your report, §5.4 deadline passed,
 *      §5.1 HR-approved). That sentence is written for the operator and names
 *      WHICH rule refused; re-wording it into "Something went wrong" throws away
 *      the only useful part.
 *   5. **§8.3 is a branch, not a filter.** A C-Level participant has no
 *      goal-setting step at all, so the screen says so and shows nothing else —
 *      no empty KPI list implying someone forgot.
 */

export interface KpiRecord {
  id: string;
  description: string;
  /** Decimal STRING — see note 3 above. */
  weightage: string;
  descriptorOutstanding: string;
  descriptorExcellent: string;
  descriptorTarget: string;
  descriptorAlmostAchieved: string;
  descriptorUnsatisfactory: string;
  orderIndex: number;
}

/** The §5.3 position of the set, as the API reports it after every write. */
export interface WeightageSet {
  kpiCount: number;
  weightageTotal: string;
  weightageComplete: boolean;
  weightageMessage: string | null;
}

export interface SignOffSnapshot {
  employeeSignedAt: string | null;
  managerSignedAt: string | null;
}

interface KpiDraftBoardProps {
  participantId: string;
  /** §8.3 — a C-Level participant has no goal-setting step at all. */
  goalSettingExempt: boolean;
  stage: GoalStage | null;
  /** Verbatim server sentence, or null when this actor may edit right now. */
  editBlockedReason: string | null;
  initialKpis: KpiRecord[];
  initialSet: WeightageSet;
  initialSignOff: SignOffSnapshot;
  /** §5.1's lock. Non-null means the baseline is frozen. */
  goalsApprovedAt: string | null;
  /** §5.1 — the viewer IS this employee, so they may sign the EMPLOYEE party. */
  isSubject: boolean;
  /** §4.2 — the viewer is the direct line manager (or HR), so they may sign MANAGER. */
  canSignAsManager: boolean;
}

type Party = "EMPLOYEE" | "MANAGER";

export function KpiDraftBoard({
  participantId,
  goalSettingExempt,
  stage,
  editBlockedReason,
  initialKpis,
  initialSet,
  initialSignOff,
  goalsApprovedAt,
  isSubject,
  canSignAsManager,
}: KpiDraftBoardProps) {
  const t = useTranslations("pms.kpi");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { success, error: showError } = useNotify();

  const [kpis, setKpis] = useState<KpiRecord[]>(initialKpis);
  const [set, setSet] = useState<WeightageSet>(initialSet);
  const [signOff, setSignOff] = useState<SignOffSnapshot>(initialSignOff);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<KpiRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [signingParty, setSigningParty] = useState<Party | null>(null);
  /** A 409/403 the SERVER just returned — the page's gate, learned late. */
  const [serverBlocked, setServerBlocked] = useState<string | null>(null);

  // §8.3 — categorical, and answered before anything else. There is no KPI set
  // to draft, so there is no screen to draft it on.
  if (goalSettingExempt) {
    return (
      <div className="space-y-6">
        <StageBanner stage={stage} />
        <SectionCard title={t("exemptTitle")}>
          <EmptyState description={t("exemptBody")} />
        </SectionCard>
      </div>
    );
  }

  const blockedReason = serverBlocked ?? editBlockedReason;
  const canEdit = blockedReason === null;
  const stageLocked = stage === null || stage.state !== "OPEN";

  /**
   * A refusal from a write route. 409 and 403 are STATE, not accidents: the
   * deadline passed, HR approved, the report moved. They are latched so every
   * affordance on the screen reflects the answer the server just gave.
   */
  function absorbFailure(e: unknown, fallback: string): string {
    const message = e instanceof ApiError ? e.message : fallback;
    if (e instanceof ApiError && (e.status === 409 || e.status === 403)) {
      setServerBlocked(message);
    }
    return message;
  }

  async function handleCreate(values: KpiFormValues) {
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await apiClient.post<{ kpi: KpiRecord; set: WeightageSet }>("/api/kpis", {
        participantId,
        ...values,
        orderIndex: kpis.length,
      });
      setKpis((rows) => [...rows, result.kpi]);
      setSet(result.set);
      setCreateOpen(false);
      success(t("createdToast"));
      router.refresh();
    } catch (e) {
      setFormError(absorbFailure(e, t("saveFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(values: KpiFormValues) {
    if (!editing) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await apiClient.put<{ kpi: KpiRecord; set: WeightageSet }>(
        `/api/kpis/${editing.id}`,
        values,
      );
      setKpis((rows) => rows.map((row) => (row.id === result.kpi.id ? result.kpi : row)));
      setSet(result.set);
      setEditing(null);
      success(t("updatedToast"));
      router.refresh();
    } catch (e) {
      setFormError(absorbFailure(e, t("saveFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(kpi: KpiRecord) {
    setBusyId(kpi.id);
    try {
      const result = await apiClient.delete<{ id: string; set: WeightageSet }>(
        `/api/kpis/${kpi.id}`,
      );
      setKpis((rows) => rows.filter((row) => row.id !== result.id));
      setSet(result.set);
      success(t("deletedToast"));
      router.refresh();
    } catch (e) {
      showError(absorbFailure(e, t("deleteFailed")));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSign(party: Party) {
    setSigningParty(party);
    try {
      const result = await apiClient.post<{
        signOff: { signedAt: string };
        alreadySigned: boolean;
      }>("/api/signoffs", { participantId, party });
      setSignOff((prev) => ({
        ...prev,
        ...(party === "EMPLOYEE"
          ? { employeeSignedAt: result.signOff.signedAt }
          : { managerSignedAt: result.signOff.signedAt }),
      }));
      success(result.alreadySigned ? t("alreadySignedToast") : t("signedToast"));
      router.refresh();
    } catch (e) {
      showError(absorbFailure(e, t("signFailed")));
    } finally {
      setSigningParty(null);
    }
  }

  const parties: { party: Party; signedAt: string | null; canSign: boolean }[] = [
    { party: "EMPLOYEE", signedAt: signOff.employeeSignedAt, canSign: isSubject },
    { party: "MANAGER", signedAt: signOff.managerSignedAt, canSign: canSignAsManager },
  ];

  return (
    <div className="space-y-6">
      <StageBanner stage={stage} />

      {goalsApprovedAt ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border border-border bg-card p-4"
        >
          <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{t("approvedTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {t("approvedBody", { datetime: formatDateTime(goalsApprovedAt) })}
            </p>
          </div>
        </div>
      ) : null}

      {blockedReason && !goalsApprovedAt ? (
        // Quoted verbatim: the sentence names WHICH rule refused (§4.2 / §5.4 /
        // §5.1) and is the same one the write route would answer with.
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-border bg-card p-4"
        >
          <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{t("blockedTitle")}</p>
            <p className="text-xs text-muted-foreground">{blockedReason}</p>
          </div>
        </div>
      ) : null}

      {/* §5.3's live position. The gap is stated; nothing here refuses a save. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">{t("weightageTotal")}</p>
          <p className="text-h4 font-semibold text-foreground">
            {t("weightageValue", { total: set.weightageTotal })}
          </p>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-1">
          <Badge variant={set.weightageComplete ? "success" : "warning"}>
            {set.weightageComplete ? t("weightageComplete") : t("weightageOnTrack")}
          </Badge>
          {/* The server's own sentence, which already states the gap in exact
              decimal arithmetic — re-deriving it here would mean re-summing the
              set as floats. */}
          {set.weightageMessage ? (
            <p className="max-w-prose text-xs text-muted-foreground">{set.weightageMessage}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-h5 font-semibold text-foreground">
          {t("kpiSetTitle", { count: set.kpiCount })}
        </h3>
        {canEdit ? (
          <Button
            onClick={() => {
              setFormError(null);
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            {t("addAction")}
          </Button>
        ) : null}
      </div>

      {kpis.length === 0 ? (
        <div className="rounded-md border border-border bg-card">
          <EmptyState
            description={canEdit ? t("empty") : t("emptyReadOnly")}
            actionLabel={canEdit ? t("addAction") : undefined}
            onAction={canEdit ? () => setCreateOpen(true) : undefined}
            actionVariant="outline"
          />
        </div>
      ) : (
        <ul className="flex list-none flex-col gap-4 p-0">
          {kpis.map((kpi) => (
            <li key={kpi.id} className="rounded-md border border-border bg-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-foreground">{kpi.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("kpiWeightage", { weightage: kpi.weightage })}
                  </p>
                </div>
                {canEdit ? (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === kpi.id}
                      onClick={() => {
                        setFormError(null);
                        setEditing(kpi);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                      {t("editAction")}
                    </Button>
                    <ConfirmAction
                      title={t("deleteConfirmTitle")}
                      description={t("deleteConfirmBody")}
                      okText={t("deleteAction")}
                      okType="danger"
                      onConfirm={() => handleDelete(kpi)}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === kpi.id}
                        aria-label={t("deleteAction")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </ConfirmAction>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 border-t border-border pt-4">
                <DescriptionList
                  bordered={false}
                  columns={1}
                  size="small"
                  items={KPI_LEVEL_FIELDS.map((level) => ({
                    key: level.field,
                    label: (
                      <span className="flex flex-wrap items-center gap-2">
                        {t(`level.${level.field}`)}
                        <Badge variant="outline">{t("levelValue", { value: level.value })}</Badge>
                      </span>
                    ),
                    value: kpi[level.field],
                  }))}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <SectionCard title={t("signOffTitle")} subtitle={t("signOffBody")}>
        <div className="space-y-4">
          {parties.map(({ party, signedAt, canSign }) => (
            <div
              key={party}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-foreground">{t(`party.${party}`)}</p>
                {/* The unsigned state is the signal (§5.3) — so it is stated,
                    not left as a missing row. */}
                <p className="text-xs text-muted-foreground">
                  {signedAt
                    ? t("signedAt", { datetime: formatDateTime(signedAt) })
                    : t("notSigned")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {signedAt ? <Badge variant="success">{t("signedBadge")}</Badge> : null}
                {!signedAt && canSign ? (
                  <Button
                    variant="secondary"
                    // §5.3: exactly 100% is required to sign. The BOOLEAN decides
                    // — never a client-side re-sum of the decimal string.
                    disabled={
                      !set.weightageComplete ||
                      stageLocked ||
                      signingParty !== null ||
                      !!serverBlocked
                    }
                    onClick={() => handleSign(party)}
                  >
                    {signingParty === party
                      ? t("signing")
                      : party === "EMPLOYEE"
                        ? t("signAsEmployee")
                        : t("signAsManager")}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{t("noRejectNote")}</p>
        </div>
      </SectionCard>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setFormError(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("formNote")}</DialogDescription>
          </DialogHeader>

          <KpiForm formId="kpi-create-form" submitting={submitting} onSubmit={handleCreate} />

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" form="kpi-create-form" disabled={submitting}>
              {submitting ? t("saving") : t("saveAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setFormError(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("editTitle")}</DialogTitle>
            <DialogDescription>{t("formNote")}</DialogDescription>
          </DialogHeader>

          {editing ? (
            <KpiForm
              key={editing.id}
              formId="kpi-edit-form"
              initial={editing}
              submitting={submitting}
              onSubmit={handleUpdate}
            />
          ) : null}

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={submitting}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" form="kpi-edit-form" disabled={submitting}>
              {submitting ? t("saving") : t("saveAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

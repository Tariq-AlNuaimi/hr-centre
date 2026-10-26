"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { Field } from "../Field";
import { LoadFailed, LoadingBlock } from "../States";
import { useJmlAction, useJmlLookups } from "../use-jml";

type Asset = {
  id: string;
  assetType: { label: string };
  description: string | null;
  identifier: string | null;
  issuedDate: string | null;
  returnDueDate: string | null;
  returnedDate: string | null;
  conditionAtReturn: string | null;
  deductionApplicable: boolean;
  deductionAmount?: string | null;
  writtenOff: boolean;
  writtenOffReason: string | null;
  returnedOnCaseId: string | null;
};
type Listing = {
  assets: Asset[];
  outstanding: number;
  can: { manage: boolean; deduction: boolean; seeMoney: boolean };
};

const today = () => new Date().toISOString().slice(0, 10);

/** The asset register on a case (§9.8.1): issued on a joiner, returned on a leaver. */
export function AssetsSection({
  caseId,
  active,
  leave,
}: {
  caseId: string;
  active: boolean;
  leave: boolean;
}) {
  const t = useTranslations("jml.register.assets");
  const q = useQuery({
    queryKey: ["jml", "case", caseId, "assets"],
    queryFn: () => apiClient.get<Listing>(`/api/jml/cases/${caseId}/assets`),
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !q.data) return <LoadFailed />;
  const d = q.data;
  return (
    <SectionCard
      title={t("title")}
      subtitle={leave ? t("leaveNote", { count: d.outstanding }) : t("joinNote")}
      actions={d.can.manage && active ? <AddAsset caseId={caseId} leave={leave} /> : null}
    >
      {d.assets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {d.assets.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-2 text-sm"
            >
              <div>
                <p className="font-medium">
                  {a.assetType.label}
                  {a.identifier ? ` · ${a.identifier}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.writtenOff
                    ? t("writtenOff", { reason: a.writtenOffReason ?? "" })
                    : a.returnedDate
                      ? t("returned", {
                          date: a.returnedDate.slice(0, 10),
                          condition: a.conditionAtReturn ?? "",
                        })
                      : a.returnedOnCaseId === caseId
                        ? t("due", { date: a.returnDueDate?.slice(0, 10) ?? "—" })
                        : t("issued", { date: a.issuedDate?.slice(0, 10) ?? "—" })}
                  {a.deductionApplicable
                    ? ` · ${d.can.seeMoney ? t("deduction", { amount: a.deductionAmount ?? "—" }) : t("deductionHidden")}`
                    : ""}
                </p>
              </div>
              {d.can.manage &&
              active &&
              a.returnedOnCaseId === caseId &&
              !a.returnedDate &&
              !a.writtenOff ? (
                <div className="flex gap-2">
                  <ReturnAsset caseId={caseId} asset={a} deduction={d.can.deduction} />
                  {d.can.deduction ? <WriteOff caseId={caseId} asset={a} /> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function AddAsset({ caseId, leave }: { caseId: string; leave: boolean }) {
  const t = useTranslations("jml.register.assets");
  const lookups = useJmlLookups();
  const { run, busy } = useJmlAction(t("failed"));
  const [v, setV] = useState({ assetTypeId: "", identifier: "", description: "", date: "" });
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="outline">
          {t("add")}
        </Button>
      }
      title={leave ? t("addReturnTitle") : t("issueTitle")}
      confirmLabel={t("add")}
      busy={busy}
      disabled={!v.assetTypeId}
      onConfirm={async () =>
        Boolean(
          await run(
            () =>
              apiClient.post(`/api/jml/cases/${caseId}/assets`, {
                assetTypeId: v.assetTypeId,
                identifier: v.identifier.trim() || null,
                description: v.description.trim() || null,
                ...(leave ? { returnDueDate: v.date || null } : { issuedDate: v.date || null }),
              }),
            t("added"),
          ),
        )
      }
    >
      <Field id="asset-type" label={t("type")}>
        <NativeSelect
          id="asset-type"
          className="w-full"
          value={v.assetTypeId}
          onChange={(e) => set({ assetTypeId: e.target.value })}
        >
          <option value="">{t("choose")}</option>
          {(lookups.data?.assetTypes ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="asset-id" label={t("identifier")}>
        <Input
          id="asset-id"
          value={v.identifier}
          onChange={(e) => set({ identifier: e.target.value })}
        />
      </Field>
      <Field id="asset-desc" label={t("description")}>
        <Input
          id="asset-desc"
          value={v.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>
      <Field
        id="asset-date"
        label={leave ? t("returnDue") : t("issuedOn")}
        hint={leave ? t("returnDueHint") : undefined}
      >
        <Input
          id="asset-date"
          type="date"
          value={v.date}
          onChange={(e) => set({ date: e.target.value })}
        />
      </Field>
    </ActionDialog>
  );
}

function ReturnAsset({
  caseId,
  asset,
  deduction,
}: {
  caseId: string;
  asset: Asset;
  deduction: boolean;
}) {
  const t = useTranslations("jml.register.assets");
  const { run, busy } = useJmlAction(t("failed"));
  const [v, setV] = useState({
    returnedDate: today(),
    conditionAtReturn: "",
    deductionApplicable: false,
    amount: "",
  });
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  return (
    <ActionDialog
      trigger={<Button size="sm">{t("return")}</Button>}
      title={t("returnTitle", { type: asset.assetType.label })}
      confirmLabel={t("return")}
      busy={busy}
      disabled={!v.conditionAtReturn.trim() || (v.deductionApplicable && !v.amount)}
      onConfirm={async () =>
        Boolean(
          await run(
            () =>
              apiClient.post(`/api/jml/cases/${caseId}/assets/${asset.id}/return`, {
                returnedDate: v.returnedDate,
                conditionAtReturn: v.conditionAtReturn.trim(),
                deductionApplicable: v.deductionApplicable,
                deductionAmount: v.deductionApplicable ? v.amount : null,
              }),
            t("returnedDone"),
          ),
        )
      }
    >
      <Field id="ret-date" label={t("returnedOn")}>
        <Input
          id="ret-date"
          type="date"
          value={v.returnedDate}
          onChange={(e) => set({ returnedDate: e.target.value })}
        />
      </Field>
      <Field id="ret-cond" label={t("condition")}>
        <Input
          id="ret-cond"
          value={v.conditionAtReturn}
          onChange={(e) => set({ conditionAtReturn: e.target.value })}
        />
      </Field>
      {deduction ? (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={v.deductionApplicable}
              onChange={(e) => set({ deductionApplicable: e.target.checked })}
            />
            {t("deductionApplies")}
          </label>
          {v.deductionApplicable ? (
            <Field id="ret-amount" label={t("amount")}>
              <Input
                id="ret-amount"
                inputMode="decimal"
                value={v.amount}
                onChange={(e) => set({ amount: e.target.value })}
              />
            </Field>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t("deductionNeedsSenior")}</p>
      )}
    </ActionDialog>
  );
}

function WriteOff({ caseId, asset }: { caseId: string; asset: Asset }) {
  const t = useTranslations("jml.register.assets");
  const { run, busy } = useJmlAction(t("failed"));
  const [reason, setReason] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="outline">
          {t("writeOff")}
        </Button>
      }
      title={t("writeOffTitle", { type: asset.assetType.label })}
      confirmLabel={t("writeOff")}
      destructive
      busy={busy}
      disabled={reason.trim().length < 3}
      onConfirm={async () =>
        Boolean(
          await run(
            () =>
              apiClient.post(`/api/jml/cases/${caseId}/assets/${asset.id}/write-off`, {
                reason: reason.trim(),
              }),
            t("writtenOffDone"),
          ),
        )
      }
    >
      <Field id="wo-reason" label={t("reason")}>
        <Input id="wo-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}

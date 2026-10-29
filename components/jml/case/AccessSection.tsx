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
import { Field } from "@/components/shared/FormControls";
import { LoadFailed, LoadingBlock } from "../States";
import { useJmlAction } from "../use-jml";
import { AccessCutoff, AccessSummary, type Cutoff, type DomainSummary } from "./AccessCutoff";

export const ACCESS_DOMAINS = [
  "IDENTITY",
  "COMMUNICATION",
  "NETWORK",
  "CODE_AND_INFRASTRUCTURE",
  "DATA",
  "THIRD_PARTY_AND_SAAS",
  "SHARED_CREDENTIALS",
  "PHYSICAL",
  "EXTERNAL_FACING",
] as const;

type Item = {
  id: string;
  direction: "GRANT" | "REVOKE";
  domain: string;
  systemName: string;
  sharedCredential: boolean;
  rotationRequired: boolean;
  dueDate: string;
  confirmedDate: string | null;
  confirmingParty: string | null;
  reference: string | null;
};
type Listing = {
  items: Item[];
  open: number;
  unrotatedShared: string[];
  can: { manage: boolean };
  summary: DomainSummary[];
  cutoff: Cutoff | null;
};

const today = () => new Date().toISOString().slice(0, 10);

/** The access register (§9.8): each item confirmed with party, date and reference. */
export function AccessSection({ caseId, active }: { caseId: string; active: boolean }) {
  const t = useTranslations("jml.register.access");
  const tv = useTranslations("jml.register.domain");
  const q = useQuery({
    queryKey: ["jml", "case", caseId, "access"],
    queryFn: () => apiClient.get<Listing>(`/api/jml/cases/${caseId}/access`),
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !q.data) return <LoadFailed />;
  const d = q.data;
  return (
    <SectionCard
      title={t("title")}
      subtitle={t("openCount", { count: d.open })}
      actions={d.can.manage && active ? <AddAccess caseId={caseId} /> : null}
    >
      {d.cutoff ? (
        <AccessCutoff caseId={caseId} cutoff={d.cutoff} canManage={d.can.manage && active} />
      ) : null}
      <AccessSummary rows={d.summary} />
      {d.unrotatedShared.length > 0 ? (
        <p role="status" className="mb-3 rounded-md bg-status-warn p-2 text-sm text-status-warn-fg">
          {t("unrotated", { list: d.unrotatedShared.join(", ") })}
        </p>
      ) : null}
      {d.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {d.items.map((i) => (
            <li
              key={i.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-2 text-sm"
            >
              <div>
                <p className="font-medium">{i.systemName}</p>
                <p className="text-xs text-muted-foreground">
                  {tv(i.domain)}
                  {i.rotationRequired ? ` · ${t("rotate")}` : ""} ·{" "}
                  {i.confirmedDate
                    ? t("confirmed", {
                        date: i.confirmedDate.slice(0, 10),
                        party: i.confirmingParty ?? "",
                        ref: i.reference ?? "",
                      })
                    : t("due", { date: i.dueDate.slice(0, 10) })}
                </p>
              </div>
              {d.can.manage && active && !i.confirmedDate ? (
                <ConfirmAccess caseId={caseId} item={i} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function AddAccess({ caseId }: { caseId: string }) {
  const t = useTranslations("jml.register.access");
  const tv = useTranslations("jml.register.domain");
  const { run, busy } = useJmlAction(t("failed"));
  const [v, setV] = useState({
    domain: "IDENTITY",
    systemName: "",
    sharedCredential: false,
    dueDate: "",
  });
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="outline">
          {t("add")}
        </Button>
      }
      title={t("addTitle")}
      confirmLabel={t("add")}
      busy={busy}
      disabled={!v.systemName.trim()}
      onConfirm={async () =>
        Boolean(
          await run(
            () =>
              apiClient.post(`/api/jml/cases/${caseId}/access`, {
                domain: v.domain,
                systemName: v.systemName.trim(),
                sharedCredential: v.sharedCredential,
                dueDate: v.dueDate || null,
              }),
            t("added"),
          ),
        )
      }
    >
      <Field id="acc-domain" label={t("domain")}>
        <NativeSelect
          id="acc-domain"
          className="w-full"
          value={v.domain}
          onChange={(e) => set({ domain: e.target.value })}
        >
          {ACCESS_DOMAINS.map((d) => (
            <option key={d} value={d}>
              {tv(d)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="acc-name" label={t("system")}>
        <Input
          id="acc-name"
          value={v.systemName}
          onChange={(e) => set({ systemName: e.target.value })}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.sharedCredential}
          onChange={(e) => set({ sharedCredential: e.target.checked })}
        />
        {t("shared")}
      </label>
      <Field id="acc-due" label={t("dueDate")} hint={t("dueHint")}>
        <Input
          id="acc-due"
          type="date"
          value={v.dueDate}
          onChange={(e) => set({ dueDate: e.target.value })}
        />
      </Field>
    </ActionDialog>
  );
}

function ConfirmAccess({ caseId, item }: { caseId: string; item: Item }) {
  const t = useTranslations("jml.register.access");
  const { run, busy } = useJmlAction(t("failed"));
  const [v, setV] = useState({ confirmingParty: "", confirmedDate: today(), reference: "" });
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  return (
    <ActionDialog
      trigger={<Button size="sm">{t("confirm")}</Button>}
      title={t("confirmTitle", { name: item.systemName })}
      description={item.rotationRequired ? t("rotateNote") : undefined}
      confirmLabel={t("confirm")}
      busy={busy}
      disabled={!v.confirmingParty.trim() || !v.confirmedDate || !v.reference.trim()}
      onConfirm={async () =>
        Boolean(
          await run(
            () =>
              apiClient.post(`/api/jml/cases/${caseId}/access/${item.id}/confirm`, {
                confirmingParty: v.confirmingParty.trim(),
                confirmedDate: v.confirmedDate,
                reference: v.reference.trim(),
              }),
            t("confirmedDone"),
          ),
        )
      }
    >
      <Field id={`acc-party-${item.id}`} label={t("party")}>
        <Input
          id={`acc-party-${item.id}`}
          value={v.confirmingParty}
          onChange={(e) => set({ confirmingParty: e.target.value })}
        />
      </Field>
      <Field id={`acc-date-${item.id}`} label={t("date")}>
        <Input
          id={`acc-date-${item.id}`}
          type="date"
          value={v.confirmedDate}
          onChange={(e) => set({ confirmedDate: e.target.value })}
        />
      </Field>
      <Field id={`acc-ref-${item.id}`} label={t("reference")}>
        <Input
          id={`acc-ref-${item.id}`}
          value={v.reference}
          onChange={(e) => set({ reference: e.target.value })}
        />
      </Field>
    </ActionDialog>
  );
}

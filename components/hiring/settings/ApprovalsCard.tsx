"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { SectionCard } from "@/components/shared/SectionCard";
import { useHiringMutation } from "../ui/api";
import { Field } from "../ui/fields";
import { QueryState } from "../ui/states";
import { GENERAL, useGeneral } from "./ScoringCards";
import { APPROVAL_ROLES, type GeneralView } from "./types";

const FLOOR = ["HR_MANAGER", "OPERATIONS_DIRECTOR"];

/** Offer approval chains per company (may only add to HR manager → Operations director) and the COO threshold. */
export function ApprovalsCard() {
  const t = useTranslations("hiring.settings");
  const q = useGeneral();
  return (
    <SectionCard title={t("approvalsTitle")} subtitle={t("approvalsHint")}>
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rows={4}>
        {q.data ? <ApprovalsForm key={JSON.stringify(q.data.approvals)} g={q.data} /> : null}
      </QueryState>
    </SectionCard>
  );
}

function ApprovalsForm({ g }: { g: GeneralView }) {
  const t = useTranslations("hiring.settings");
  const tr = useTranslations("hiring.roles");
  const [chains, setChains] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(g.entities.map((e) => [e.code, g.approvals.chains[e.code] ?? FLOOR])),
  );
  const [threshold, setThreshold] = useState(String(g.approvals.cooThreshold));
  const save = useHiringMutation<object>("PUT", GENERAL, { success: t("saved") });
  const ro = !g.canEdit;
  const edit = (code: string, next: string[]) => setChains((c) => ({ ...c, [code]: next }));
  return (
    <div className="space-y-4">
      {g.entities.map((e) => {
        const chain = chains[e.code] ?? FLOOR;
        const addable = APPROVAL_ROLES.filter((r) => !chain.includes(r));
        return (
          <div key={e.code} className="rounded-md border border-border p-3">
            <p className="mb-2 text-sm font-semibold">{e.name}</p>
            <ol className="flex flex-wrap items-center gap-2 text-sm">
              {chain.map((r, i) => (
                <li key={r} className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                  <span className="text-muted-foreground">{i + 1}</span>
                  {tr(r)}
                  {!ro && !FLOOR.includes(r) ? (
                    <button
                      type="button"
                      aria-label={t("removeRole", { role: tr(r) })}
                      onClick={() =>
                        edit(
                          e.code,
                          chain.filter((x) => x !== r),
                        )
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
            {!ro && addable.length ? (
              <div className="mt-2 flex items-center gap-2">
                <NativeSelect
                  aria-label={t("addRole")}
                  id={`add-${e.code}`}
                  defaultValue=""
                  onChange={(ev) => ev.target.value && edit(e.code, [...chain, ev.target.value])}
                >
                  <option value="">{t("addRole")}</option>
                  {addable.map((r) => (
                    <option key={r} value={r}>
                      {tr(r)}
                    </option>
                  ))}
                </NativeSelect>
                <Plus aria-hidden className="h-4 w-4 text-muted-foreground" />
              </div>
            ) : null}
          </div>
        );
      })}
      <Field label={t("cooThreshold")} htmlFor="coo-th" hint={t("cooThresholdHint")}>
        <Input
          id="coo-th"
          type="number"
          min={0}
          className="w-48"
          readOnly={ro}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
        />
      </Field>
      {ro ? null : (
        <Button
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              section: "approvals",
              value: { chains, cooThreshold: Number(threshold) },
            })
          }
        >
          {t("save")}
        </Button>
      )}
    </div>
  );
}

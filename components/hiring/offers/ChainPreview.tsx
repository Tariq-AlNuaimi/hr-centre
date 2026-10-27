"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { qs, useHiringQuery } from "../ui/api";
import type { ChainStepView } from "./types";
import { QueryState } from "../ui/states";

type Preview = {
  threshold: number;
  steps: {
    sequence: number;
    role: ChainStepView["role"];
    approvers: { id: string; name: string }[];
    recused: boolean;
  }[];
};

/** The chain submitting this offer would route to (Interview Hub `ApprovalChainPreview`). */
export function ChainPreview({ candidateId, total }: { candidateId: string; total: number }) {
  const t = useTranslations("hiring.offerForm");
  const tr = useTranslations("hiring.roles");
  const [debounced, setDebounced] = useState(total);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(total), 400);
    return () => clearTimeout(h);
  }, [total]);
  const q = useHiringQuery<Preview>(
    `/api/hiring/offers/chain-preview${qs({ candidateId, total: debounced })}`,
  );
  const coo = q.data?.steps.some((s) => s.role === "COO");
  return (
    <SectionCard title={t("chainTitle")} subtitle={t("chainHint")}>
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rows={3}>
        {q.data ? (
          <div className="space-y-3 text-sm">
            <ol className="space-y-2">
              {q.data.steps.map((s) => (
                <li key={s.sequence} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted font-mono text-xs font-bold">
                    {s.sequence}
                  </span>
                  <div>
                    <p className="font-semibold">{tr(s.role)}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.approvers.length
                        ? s.approvers.map((a) => a.name).join(", ")
                        : s.recused
                          ? t("recused")
                          : t("noHolder")}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground">
              {coo
                ? t("cooJoins", { threshold: q.data.threshold.toLocaleString("en-US") })
                : t("cooBelow", { threshold: q.data.threshold.toLocaleString("en-US") })}
            </p>
          </div>
        ) : null}
      </QueryState>
    </SectionCard>
  );
}

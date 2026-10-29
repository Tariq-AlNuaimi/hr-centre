"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { Field } from "@/components/shared/FormControls";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";

type Code = { id: string; code: string; label: string; active: boolean; sortOrder: number };
type Category = { id: string; level1: string; label: string; active: boolean; codes: Code[] };

/** The exit-reason taxonomy (§12.3) — what the interview validates against (F9). Codes are deactivated, never deleted. */
export function ReasonCodesSettings() {
  const t = useTranslations("jml.settings.reasonCodes");
  const { can, isLoading } = useJmlAccess();
  const q = useQuery({
    queryKey: ["jml", "reason-codes"],
    queryFn: () => apiClient.get<Category[]>("/api/jml/config/reason-codes"),
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
  return (
    <div className="space-y-6">
      {header}
      {q.data.map((c) => (
        <CategoryCard key={c.id} category={c} />
      ))}
    </div>
  );
}

function CategoryCard({ category }: { category: Category }) {
  const t = useTranslations("jml.settings.reasonCodes");
  const { run, busy } = useJmlAction(t("failed"));
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const save = (c: Partial<Code> & { code: string; label: string }) =>
    run(
      () =>
        apiClient.put("/api/jml/config/reason-codes", {
          level1: category.level1,
          sortOrder: 0,
          active: true,
          ...c,
        }),
      t("saved"),
    );
  return (
    <SectionCard title={category.label}>
      <ul className="divide-y divide-border">
        {category.codes.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>{`${c.code} ${c.label}`}</span>
            <span className="flex items-center gap-2">
              <Badge variant={c.active ? "default" : "outline"}>
                {c.active ? t("active") : t("inactive")}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void save({ ...c, active: !c.active })}
              >
                {c.active ? t("deactivate") : t("activate")}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
        <Field id={`rc-code-${category.level1}`} label={t("code")}>
          <Input
            id={`rc-code-${category.level1}`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </Field>
        <Field id={`rc-label-${category.level1}`} label={t("label")}>
          <Input
            id={`rc-label-${category.level1}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Button
          size="sm"
          disabled={busy || !/^[A-Z]{3}-\d{2}$/.test(code) || label.trim().length < 2}
          onClick={async () => {
            if (await save({ code, label: label.trim(), sortOrder: category.codes.length + 1 })) {
              setCode("");
              setLabel("");
            }
          }}
        >
          {t("add")}
        </Button>
      </div>
    </SectionCard>
  );
}

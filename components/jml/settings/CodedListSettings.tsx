"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { Field } from "@/components/shared/FormControls";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";

type Item = {
  id: string;
  code: string;
  label?: string;
  name?: string;
  sortOrder: number;
  active: boolean;
};

const ENDPOINT = {
  classifications: "/api/jml/config/position-classifications",
  "contract-types": "/api/jml/config/contract-types",
} as const;

/**
 * A coded configuration list: position classifications (Offboarding C8, ships
 * empty) and contract types (Onboarding §7.4, ships empty — activation is
 * blocked until HR enters the approved list). Never deleted, only deactivated.
 */
export function CodedListSettings({ kind }: { kind: keyof typeof ENDPOINT }) {
  const t = useTranslations(
    `jml.settings.${kind === "classifications" ? "classifications" : "contractTypes"}`,
  );
  const tc = useTranslations("jml.settings.list");
  const { can, isLoading } = useJmlAccess();
  const allowed = can("jml.configure");
  const [showInactive, setShowInactive] = useState(false);
  const endpoint = ENDPOINT[kind];
  const q = useQuery({
    queryKey: ["jml", kind, showInactive],
    queryFn: () => apiClient.get<Item[]>(`${endpoint}?includeInactive=${showInactive}`),
    enabled: allowed,
  });
  const { run, busy } = useJmlAction(tc("saveFailed"));
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const labelKey = kind === "classifications" ? "label" : "name";
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  if (isLoading || (allowed && q.isLoading))
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  if (!allowed)
    return (
      <div className="space-y-6">
        {header}
        <NotPermitted title={t("title")} />
      </div>
    );
  if (q.isError)
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed />
      </div>
    );
  const items = q.data ?? [];
  return (
    <div className="space-y-6">
      {header}
      <SectionCard
        title={t("listTitle")}
        actions={
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            {tc("showInactive")}
          </label>
        }
      >
        {items.length === 0 ? (
          <EmptyState description={t("empty")} />
        ) : (
          <ul className="mb-4 divide-y divide-border">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="flex items-center gap-2 text-foreground">
                  <Badge variant="outline">{item.code}</Badge>
                  {item[labelKey]}
                  {item.active ? null : <Badge>{tc("inactive")}</Badge>}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => apiClient.patch(`${endpoint}/${item.id}`, { active: !item.active }),
                      item.active ? tc("deactivated") : tc("reactivated"),
                    )
                  }
                >
                  {item.active ? tc("deactivate") : tc("reactivate")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-end gap-3 border-t border-border pt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const done = await run(
              () =>
                apiClient.post(endpoint, {
                  code,
                  [labelKey]: label,
                  sortOrder: Number(sortOrder) || 0,
                }),
              tc("added"),
            );
            if (done) {
              setCode("");
              setLabel("");
            }
          }}
        >
          <Field id={`${kind}-code`} label={tc("code")}>
            <Input
              id={`${kind}-code`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-40"
              required
            />
          </Field>
          <Field id={`${kind}-label`} label={t("labelField")}>
            <Input
              id={`${kind}-label`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-64"
              required
            />
          </Field>
          <Field id={`${kind}-order`} label={tc("sortOrder")}>
            <Input
              id={`${kind}-order`}
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="w-24"
            />
          </Field>
          <Button type="submit" disabled={busy || !code.trim() || !label.trim()}>
            {tc("add")}
          </Button>
        </form>
      </SectionCard>
    </div>
  );
}

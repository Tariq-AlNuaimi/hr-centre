"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { ACCESS_DOMAINS } from "../case/AccessSection";
import { Field } from "../Field";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";

type AssetType = { id: string; label: string; active: boolean; sortOrder: number };
type ChecklistItem = AssetType & {
  domain: string;
  sharedCredential: boolean;
  rotationRequired: boolean;
};

/** Asset types and the access-revocation checklist (Offboarding admin lists) — deactivated, never deleted. */
export function LeaverListsSettings({ kind }: { kind: "asset-types" | "access-checklist" }) {
  const t = useTranslations("jml.settings.leaverLists");
  const { can, isLoading } = useJmlAccess();
  const q = useQuery({
    queryKey: ["jml", kind],
    queryFn: () => apiClient.get<ChecklistItem[]>(`/api/jml/config/${kind}`),
    enabled: can("jml.configure"),
  });
  const header = <PageHeader title={t(`${kind}.title`)} subtitle={t(`${kind}.subtitle`)} />;
  if (isLoading || q.isLoading)
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  if (!can("jml.configure")) return <NotPermitted title={t(`${kind}.title`)} />;
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
      <AddRow kind={kind} />
      <SectionCard title={t("current")}>
        <ul className="divide-y divide-border">
          {q.data.map((r) => (
            <ListRow key={r.id} kind={kind} row={r} />
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

function ListRow({ kind, row }: { kind: "asset-types" | "access-checklist"; row: ChecklistItem }) {
  const t = useTranslations("jml.settings.leaverLists");
  const td = useTranslations("jml.register.domain");
  const { run, busy } = useJmlAction(t("failed"));
  const { id, ...rest } = row;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <span>
        {kind === "access-checklist" ? `${td(row.domain)} · ` : ""}
        {row.label}
        {row.rotationRequired ? ` · ${t("rotate")}` : ""}
      </span>
      <span className="flex items-center gap-2">
        <Badge variant={row.active ? "default" : "outline"}>
          {row.active ? t("active") : t("inactive")}
        </Badge>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                apiClient.put(`/api/jml/config/${kind}`, {
                  id,
                  ...pick(kind, rest),
                  active: !row.active,
                }),
              t("saved"),
            )
          }
        >
          {row.active ? t("deactivate") : t("activate")}
        </Button>
      </span>
    </li>
  );
}

function pick(kind: string, r: Omit<ChecklistItem, "id">) {
  return kind === "asset-types"
    ? { label: r.label, sortOrder: r.sortOrder }
    : {
        label: r.label,
        sortOrder: r.sortOrder,
        domain: r.domain,
        sharedCredential: r.sharedCredential,
        rotationRequired: r.rotationRequired,
      };
}

function AddRow({ kind }: { kind: "asset-types" | "access-checklist" }) {
  const t = useTranslations("jml.settings.leaverLists");
  const td = useTranslations("jml.register.domain");
  const { run, busy } = useJmlAction(t("failed"));
  const [label, setLabel] = useState("");
  const [domain, setDomain] = useState("IDENTITY");
  const [shared, setShared] = useState(false);
  const [rotate, setRotate] = useState(false);
  const checklist = kind === "access-checklist";
  return (
    <SectionCard title={t("add")}>
      <div className="grid gap-4 sm:grid-cols-3">
        {checklist ? (
          <Field id="ll-domain" label={t("domain")}>
            <NativeSelect
              id="ll-domain"
              className="w-full"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            >
              {ACCESS_DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {td(d)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        <Field id="ll-label" label={t("label")}>
          <Input id="ll-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
      </div>
      {checklist ? (
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            {t("shared")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} />
            {t("rotate")}
          </label>
        </div>
      ) : null}
      <div className="mt-4 flex justify-end">
        <Button
          size="sm"
          disabled={busy || label.trim().length < 2}
          onClick={async () => {
            const r = await run(
              () =>
                apiClient.put(
                  `/api/jml/config/${kind}`,
                  checklist
                    ? {
                        label: label.trim(),
                        domain,
                        sharedCredential: shared,
                        rotationRequired: rotate,
                      }
                    : { label: label.trim() },
                ),
              t("saved"),
            );
            if (r) setLabel("");
          }}
        >
          {t("add")}
        </Button>
      </div>
    </SectionCard>
  );
}

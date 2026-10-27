"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/PageHeader";
import { ReferenceManager, type Row } from "@/components/hive/admin/ReferenceManager";
import { useOrgOptions } from "@/components/hive/admin/use-org-options";
import { apiClient } from "@/lib/api-client";

/**
 * HR Tag pairs, their members and what each pair covers (HIVE §6.6) — the data
 * `hive_find_hr_tag` answers from and tickets route by. HIVE kept this in the
 * seed and the database only; here HR edit it. A member is linked to the HR
 * Centre login with the same email automatically: that link is the person's
 * "own HR pair" for ticket roles.
 */
export default function HivePairsPage() {
  const t = useTranslations("hive.setup");
  const pairs = useQuery({
    queryKey: ["hive-ref", "pairs"],
    queryFn: () => apiClient.get<Row[]>("/api/hive/admin/ref/pairs"),
  });
  const org = useOrgOptions(t("none"));
  const pairOptions = (pairs.data ?? []).map((p) => ({ value: p.id, label: String(p.name) }));
  const pairName = (id: unknown) => pairOptions.find((p) => p.value === id)?.label ?? "—";
  const firstPair = pairOptions[0]?.value ?? "";

  return (
    <>
      <PageHeader title={t("pairsTitle")} subtitle={t("pairsIntro")} />
      <div className="space-y-6">
        <ReferenceManager
          resource="pairs"
          title={t("pairs")}
          description={t("pairsNote")}
          rows={pairs.data}
          external
          defaults={{ name: "", order: 0, isDefault: false }}
          fields={[
            { key: "name", label: "name", kind: "text" },
            { key: "order", label: "order", kind: "number" },
            { key: "isDefault", label: "isDefault", kind: "checkbox", hint: "isDefault" },
          ]}
          columns={[
            { label: t("field.name"), render: (r) => String(r.name) },
            { label: t("field.order"), render: (r) => String(r.order) },
            {
              label: t("field.isDefault"),
              render: (r) => (r.isDefault ? <Badge variant="brand">{t("default")}</Badge> : null),
            },
          ]}
        />
        <ReferenceManager
          resource="members"
          title={t("members")}
          description={t("membersNote")}
          defaults={{ pairId: firstPair, name: "", email: "", phone: "", order: 0 }}
          fields={[
            { key: "pairId", label: "pair", kind: "select", options: pairOptions },
            { key: "name", label: "name", kind: "text" },
            { key: "email", label: "email", kind: "text" },
            { key: "phone", label: "phone", kind: "text" },
            { key: "order", label: "order", kind: "number" },
          ]}
          columns={[
            { label: t("field.pair"), render: (r) => pairName(r.pairId) },
            { label: t("field.name"), render: (r) => String(r.name) },
            { label: t("field.email"), render: (r) => String(r.email) },
            { label: t("field.phone"), render: (r) => (r.phone ? String(r.phone) : "—") },
            {
              label: t("login"),
              render: (r) =>
                r.user ? (
                  <Badge variant="success">{t("linked")}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("noLogin")}</span>
                ),
            },
          ]}
        />
        <ReferenceManager
          resource="coverage"
          title={t("coverage")}
          description={t("coverageNote")}
          defaults={{
            pairId: firstPair,
            label: "",
            aliases: [],
            entityId: "",
            companyWide: false,
            directorateId: "",
            departmentId: "",
          }}
          fields={[
            { key: "pairId", label: "pair", kind: "select", options: pairOptions },
            { key: "label", label: "label", kind: "text" },
            { key: "aliases", label: "aliases", kind: "list", hint: "aliases" },
            { key: "entityId", label: "company", kind: "select", options: org.companyOptions },
            { key: "companyWide", label: "companyWide", kind: "checkbox", hint: "companyWide" },
            {
              key: "directorateId",
              label: "directorate",
              kind: "select",
              options: org.directorateOptions,
              hint: "unitLink",
            },
            {
              key: "departmentId",
              label: "department",
              kind: "select",
              options: org.departmentOptions,
            },
          ]}
          columns={[
            { label: t("field.pair"), render: (r) => pairName(r.pairId) },
            { label: t("field.label"), render: (r) => String(r.label) },
            {
              label: t("field.aliases"),
              render: (r) => (
                <span className="text-xs text-muted-foreground">
                  {(r.aliases as string[]).join(", ") || "—"}
                </span>
              ),
            },
            {
              label: t("field.company"),
              render: (r) =>
                r.companyWide
                  ? t("wholeCompany", { company: org.companyName(r.entityId) ?? "—" })
                  : (org.companyName(r.entityId) ?? "—"),
            },
            { label: t("unit"), render: (r) => org.unitName(r) ?? "—" },
          ]}
        />
      </div>
    </>
  );
}

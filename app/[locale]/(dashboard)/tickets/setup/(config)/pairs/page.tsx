"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/PageHeader";
import { ReferenceManager, type Row } from "@/components/hive/admin/ReferenceManager";
import { LinkCards } from "@/components/shared/LinkCards";
import { apiClient } from "@/lib/api-client";

/**
 * HR Tag pairs and their members (HIVE §6.6) — what each pair covers is the core
 * HR coverage model (ADR-102, Admin › Settings › HR coverage). The data
 * `hive_find_hr_tag` answers from and tickets route by. HIVE kept this in the
 * seed and the database only; here HR edit it. A member is linked to the HR
 * Centre login with the same email automatically: that link is the person's
 * "own HR pair" for ticket roles.
 */
export default function HivePairsPage() {
  const t = useTranslations("hive.setup");
  const locale = useLocale();
  const pairs = useQuery({
    queryKey: ["hive-ref", "pairs"],
    queryFn: () => apiClient.get<Row[]>("/api/hive/admin/ref/pairs"),
  });
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
        {/* ADR-102: what each pair covers is the core HR coverage model, edited in one place. */}
        <LinkCards
          cards={[
            {
              href: `/${locale}/admin/settings/hr-coverage`,
              title: t("coverage"),
              description: t("coverageMoved"),
            },
          ]}
        />
      </div>
    </>
  );
}

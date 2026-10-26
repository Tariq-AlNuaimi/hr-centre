"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/PageHeader";
import { ReferenceManager } from "@/components/hive/admin/ReferenceManager";
import { formatDate } from "@/lib/format";

/**
 * Employee discounts (HIVE §6.4), served by `hive_employee_discounts`. An empty
 * expiry means "not specified" — never expired. Eligibility wording is fixed
 * in the tool and never asks who is asking.
 */
export default function HiveDiscountsPage() {
  const t = useTranslations("hive.setup");
  const eligibility = ["ALL", "FEMALE_ONLY", "FEMALE_PLUS_FAMILY"].map((e) => ({
    value: e,
    label: t(`eligibility.${e}`),
  }));
  return (
    <>
      <PageHeader title={t("discountsTitle")} subtitle={t("discountsIntro")} />
      <ReferenceManager
        resource="discounts"
        title={t("discounts")}
        defaults={{
          name: "",
          offerSummary: "",
          eligibility: "ALL",
          validUntil: "",
          redemption: "",
          onlineOnly: false,
          url: "",
          order: 0,
        }}
        fields={[
          { key: "name", label: "name", kind: "text" },
          { key: "offerSummary", label: "offerSummary", kind: "textarea" },
          { key: "eligibility", label: "eligibility", kind: "select", options: eligibility },
          { key: "validUntil", label: "validUntil", kind: "date", hint: "validUntil" },
          { key: "redemption", label: "redemption", kind: "textarea", hint: "redemption" },
          { key: "onlineOnly", label: "onlineOnly", kind: "checkbox" },
          { key: "url", label: "url", kind: "text" },
          { key: "order", label: "order", kind: "number" },
        ]}
        columns={[
          { label: t("field.name"), render: (r) => String(r.name) },
          {
            label: t("field.offerSummary"),
            render: (r) => <span className="text-xs">{String(r.offerSummary)}</span>,
          },
          {
            label: t("field.eligibility"),
            render: (r) => t(`eligibility.${String(r.eligibility)}`),
          },
          {
            label: t("field.validUntil"),
            render: (r) =>
              r.validUntil ? (
                formatDate(String(r.validUntil))
              ) : (
                <Badge variant="default">{t("notSpecified")}</Badge>
              ),
          },
          {
            label: t("field.onlineOnly"),
            render: (r) => (r.onlineOnly ? <Badge variant="info">{t("online")}</Badge> : null),
          },
        ]}
      />
    </>
  );
}

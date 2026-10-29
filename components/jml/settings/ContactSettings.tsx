"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { Field } from "../Field";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";

const KEYS = ["itEmail", "proEmail", "payrollEmail", "odooUrl", "staffingFormUrl"] as const;
type Key = (typeof KEYS)[number];
type Contacts = Record<Key, { value: string | null; source: "setting" | "env" | "unset" }>;

/** Desk emails and case links: HR values on the core settings store, env as fallback. */
export function ContactSettings() {
  const t = useTranslations("jml.settings.contacts");
  const { can, isLoading } = useJmlAccess();
  const allowed = can("jml.configure");
  const data = useQuery({
    queryKey: ["jml", "contacts"],
    queryFn: () => apiClient.get<Contacts>("/api/jml/config/contacts"),
    enabled: allowed,
  });
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  let content;
  if (isLoading || (allowed && data.isLoading)) content = <LoadingBlock />;
  else if (!allowed) content = <NotPermitted title={t("title")} />;
  else if (data.isError || !data.data) content = <LoadFailed />;
  else content = <ContactsForm key={JSON.stringify(data.data)} initial={data.data} />;
  return (
    <div className="space-y-6">
      {header}
      {content}
    </div>
  );
}

function ContactsForm({ initial }: { initial: Contacts }) {
  const t = useTranslations("jml.settings.contacts");
  const { run, busy } = useJmlAction(t("saveFailed"));
  const [values, setValues] = useState<Record<Key, string>>(
    Object.fromEntries(
      KEYS.map((k) => [k, initial[k].source === "setting" ? (initial[k].value ?? "") : ""]),
    ) as Record<Key, string>,
  );
  return (
    <SectionCard title={t("section")} subtitle={t("sectionNote")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              apiClient.put(
                "/api/jml/config/contacts",
                Object.fromEntries(KEYS.map((k) => [k, values[k].trim() || null])),
              ),
            t("saved"),
          );
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {KEYS.map((k) => (
            <Field
              key={k}
              id={`contact-${k}`}
              label={t(`field.${k}`)}
              hint={t(`source.${initial[k].source}`)}
            >
              <Input
                id={`contact-${k}`}
                type={k.endsWith("Email") ? "email" : "url"}
                value={values[k]}
                placeholder={initial[k].source === "env" ? (initial[k].value ?? "") : ""}
                onChange={(e) => setValues({ ...values, [k]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <Button type="submit" disabled={busy}>
          {t("save")}
        </Button>
      </form>
    </SectionCard>
  );
}

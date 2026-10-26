"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, apiClient } from "@/lib/api-client";
import { useNotify } from "@/hooks/use-notify";
import { cn } from "@/lib/utils";
import { Field } from "../Field";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";

/** The flat context every template may use (lib/jml/email/templates.ts). */
const VARIABLES = [
  "fullName",
  "firstName",
  "caseNumber",
  "jobTitle",
  "companyName",
  "startDate",
  "hrOwnerName",
]
  .map((v) => `{{${v}}}`)
  .join(" ");

type Template = {
  type: string;
  audience: string;
  subject: string;
  body: string;
  manual?: boolean;
  ccRecipients: string[];
  overridden: string[];
  updatedAt: string | null;
  updatedByName: string | null;
};

/** Joiner email copy (Onboarding §11.2) with the administrator override layer, preview and test send. */
export function EmailTemplatesSettings() {
  const t = useTranslations("jml.settings.emails");
  const { can, isLoading } = useJmlAccess();
  const allowed = can("jml.configure");
  const q = useQuery({
    queryKey: ["jml", "email-templates"],
    queryFn: () =>
      apiClient.get<{ emailEnabled: boolean; templates: Template[] }>(
        "/api/jml/config/email-templates",
      ),
    enabled: allowed,
  });
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
      <p
        role="status"
        className={cn(
          "rounded-md border border-border p-3 text-sm",
          q.data.emailEnabled
            ? "bg-status-ok text-status-ok-fg"
            : "bg-status-warn text-status-warn-fg",
        )}
      >
        {q.data.emailEnabled ? t("smtpOn") : t("smtpOff")}
      </p>
      {q.data.templates.map((tpl) => (
        <TemplateCard key={`${tpl.type}-${tpl.updatedAt ?? ""}`} template={tpl} />
      ))}
    </div>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const t = useTranslations("jml.settings.emails");
  const { run, busy } = useJmlAction(t("saveFailed"));
  const { success, error, info } = useNotify();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [cc, setCc] = useState(template.ccRecipients.join(", "));
  const [recipient, setRecipient] = useState("");
  const preview = useQuery({
    queryKey: ["jml", "email-preview", template.type, template.updatedAt],
    queryFn: () =>
      apiClient.get<{ subject: string; body: string; missing: string[] }>(
        `/api/jml/config/email-templates?type=${template.type}`,
      ),
  });
  return (
    <SectionCard
      title={t(`type.${template.type}`)}
      subtitle={t("audience", { audience: t(`audienceValue.${template.audience}`) })}
      actions={
        <div className="flex gap-2">
          {template.manual ? <Badge variant="info">{t("manual")}</Badge> : null}
          {template.overridden.length ? (
            <Badge variant="brand">{t("edited", { name: template.updatedByName ?? "" })}</Badge>
          ) : (
            <Badge>{t("approved")}</Badge>
          )}
        </div>
      }
    >
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const done = await run(
              () =>
                apiClient.patch(`/api/jml/config/email-templates/${template.type}`, {
                  subject,
                  body,
                  ccRecipients: cc
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                }),
              t("saved"),
            );
            if (done) setEditing(false);
          }}
        >
          <Field id={`${template.type}-subject`} label={t("subject")}>
            <Input
              id={`${template.type}-subject`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </Field>
          <Field
            id={`${template.type}-body`}
            label={t("body")}
            hint={t("variables", { list: VARIABLES })}
          >
            <textarea
              id={`${template.type}-body`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="w-full rounded-md border border-input bg-background p-2 font-mono text-sm text-foreground"
            />
          </Field>
          <Field id={`${template.type}-cc`} label={t("cc")} hint={t("ccHint")}>
            <Input id={`${template.type}-cc`} value={cc} onChange={(e) => setCc(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {t("save")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          {preview.isLoading ? (
            <LoadingBlock />
          ) : preview.data ? (
            <div className="rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">{preview.data.subject}</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-muted-foreground">
                {preview.data.body}
              </pre>
              {preview.data.missing.length ? (
                <p role="alert" className="mt-2 text-sm text-destructive-emphasis">
                  {t("missing", { vars: preview.data.missing.join(", ") })}
                </p>
              ) : null}
            </div>
          ) : null}
          {template.ccRecipients.length ? (
            <p className="text-xs text-muted-foreground">
              {t("ccList", { list: template.ccRecipients.join(", ") })}
            </p>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              {t("edit")}
            </Button>
            {template.overridden.length ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => apiClient.delete(`/api/jml/config/email-templates/${template.type}`),
                    t("reset"),
                  )
                }
              >
                {t("resetButton")}
              </Button>
            ) : null}
            <Field id={`${template.type}-test`} label={t("testTo")}>
              <Input
                id={`${template.type}-test`}
                type="email"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="w-64"
              />
            </Field>
            <Button
              variant="outline"
              disabled={!recipient}
              onClick={async () => {
                try {
                  const r = await apiClient.post<{ sent: boolean; reason?: string }>(
                    `/api/jml/config/email-templates/${template.type}/test`,
                    { recipient },
                  );
                  if (r.sent) success(t("testSent"));
                  else info(r.reason === "email-disabled" ? t("testDisabled") : t("testNotSent"));
                } catch (e) {
                  error(e instanceof ApiError ? e.message : t("testFailed"));
                }
              }}
            >
              {t("sendTest")}
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

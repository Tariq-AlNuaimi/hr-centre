"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { useNotify } from "@/hooks/use-notify";
import { apiClient } from "@/lib/api-client";

/**
 * §5.6's Email Template screen (US11, task 5.3).
 *
 * §5.6's requirement is that Alaa "can reword the subject, opening line, or
 * sign-off later without a developer", so this is two plain fields over the
 * stored row — not a rich editor, and deliberately not a template language.
 * What the person editing needs to know is which fragments get replaced, so the
 * placeholders are listed beside the field with what each one becomes.
 *
 * The one refusal is server-side: a body that has lost `{{answer}}` is rejected,
 * with a message that names the consequence rather than the rule. §5.6 makes the
 * approved answer "the only variable part", and a template without it sends a
 * warm, well-formatted email containing no answer — a failure only the employee
 * would ever see.
 */

const ENDPOINT = "/api/hive/admin/email-templates/escalation-answer";

interface Template {
  key: string;
  subject: string;
  body: string;
  customised: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
}

export default function EmailTemplatePage() {
  const query = useQuery<Template>({
    queryKey: ["hive", "email-template"],
    queryFn: () => apiClient.get<Template>(ENDPOINT),
  });

  if (!query.data) return <TemplateSkeleton />;
  // Remounted whenever the stored text changes, which seeds the fields from the
  // fetched values with no effect and no setState-during-render.
  return (
    <TemplateForm
      key={`${query.data.subject}|${query.data.updatedAt}`}
      template={query.data}
      refetch={() => void query.refetch()}
    />
  );
}

function TemplateSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-16 w-full max-w-md rounded-lg" />
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}

function PlaceholderList() {
  const t = useTranslations("hive.emailTemplate");
  const rows = [
    { token: "{{employeeName}}", what: t("phEmployeeName") },
    { token: "{{question}}", what: t("phQuestion") },
    { token: "{{answer}}", what: t("phAnswer") },
    { token: "{{hrPairName}}", what: t("phHrPairName") },
    { token: "{{replyLink}}", what: t("phReplyLink") },
  ];
  return (
    <SectionCard title={t("placeholdersTitle")} subtitle={t("placeholdersHint")}>
      <dl className="m-0 flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.token} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <dt className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
              {row.token}
            </dt>
            <dd className="m-0 text-sm text-muted-foreground">{row.what}</dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}

function TemplateForm({ template, refetch }: { template: Template; refetch: () => void }) {
  const t = useTranslations("hive.emailTemplate");
  const locale = useLocale();
  const notify = useNotify();
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiClient.put(ENDPOINT, { subject: subject.trim(), body: body.trim() });
      refetch();
      notify.success(t("saved"));
    } catch (error) {
      // The server's message is shown verbatim: the interesting failure is the
      // missing {{answer}}, and its message names what would have happened.
      notify.error(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await apiClient.delete(ENDPOINT);
      refetch();
      notify.success(t("resetDone"));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const edited = template.updatedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(template.updatedAt))
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("intro")} />

      <SectionCard title={t("bodyLabel")}>
        <div className="flex flex-col gap-4">
          {/* Honest about which of the two states is on screen: an editor
              pre-filled with the default looks identical to one showing a saved
              copy of it, and the difference decides whether Reset does anything. */}
          {!template.customised ? (
            <p className="m-0 text-sm text-muted-foreground">{t("usingDefault")}</p>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">
              {template.updatedByName
                ? t("editedBy", { name: template.updatedByName })
                : edited
                  ? t("editedAt", { when: edited })
                  : null}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="template-subject">{t("subjectLabel")}</Label>
            <Input
              id="template-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="template-body">{t("bodyLabel")}</Label>
            <textarea
              id="template-body"
              className="min-h-64 w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? t("saving") : t("save")}
            </Button>
            {template.customised && (
              <ConfirmAction
                title={t("reset")}
                description={t("resetConfirm")}
                okText={t("reset")}
                okType="danger"
                onConfirm={() => void reset()}
              >
                <Button variant="outline" disabled={busy}>
                  {t("reset")}
                </Button>
              </ConfirmAction>
            )}
          </div>
        </div>
      </SectionCard>

      <PlaceholderList />
    </div>
  );
}

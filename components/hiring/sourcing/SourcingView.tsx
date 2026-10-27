"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Copy, ExternalLink, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDate } from "@/lib/format";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { Field } from "../ui/fields";
import { useRequisitionOptions } from "../ui/requisition-options";
import { Notice, QueryState } from "../ui/states";

type Invite = {
  id: string;
  agencyName: string;
  requisition: { id: string; title: string } | null;
  submissions: number;
  maxSubmissions: number;
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  status: "ACTIVE" | "REVOKED" | "EXPIRED" | "LIMIT_REACHED";
};

const TONE = {
  ACTIVE: "success",
  REVOKED: "outline",
  EXPIRED: "default",
  LIMIT_REACHED: "warning",
} as const;

/**
 * `/hiring/sourcing` — the public intake HR controls: agency invite links
 * (Interview Hub `/settings/agency-invites`) and the careers page's daily
 * application cap. The board itself is the requisition's posting console.
 */
export function SourcingView() {
  const t = useTranslations("hiring.sourcing");
  const locale = useLocale();
  const q = useHiringQuery<{ data: Invite[]; total: number }>(
    "/api/hiring/agency-invites?pageSize=100",
  );
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<{ agency: string; url: string } | null>(null);
  const revoke = useHiringMutation<{ id: string }>(
    "DELETE",
    (b) => `/api/hiring/agency-invites/${b.id}`,
    { success: t("revoked") },
  );
  const rows = q.data?.data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <a
              className={buttonVariants({ variant: "outline" })}
              href={`/${locale}/careers`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="h-4 w-4" />
              {t("openBoard")}
            </a>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t("newInvite")}
            </Button>
          </>
        }
      />
      {link ? (
        <Notice tone="success" title={t("linkTitle", { agency: link.agency })}>
          <p className="mb-2">{t("linkOnce")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full rounded bg-card px-2 py-1 text-xs break-all">
              {link.url}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void navigator.clipboard.writeText(link.url).then(() => toast.success(t("copied")))
              }
            >
              <Copy className="h-4 w-4" />
              {t("copy")}
            </Button>
          </div>
        </Notice>
      ) : null}
      <SectionCard title={t("invitesTitle")} subtitle={t("invitesHint")} noBodyPadding>
        <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
          {rows.length === 0 ? (
            <EmptyState
              description={t("empty")}
              actionLabel={t("newInvite")}
              onAction={() => setCreating(true)}
              actionVariant="outline"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    {[
                      "colAgency",
                      "colScope",
                      "colSubmissions",
                      "colExpires",
                      "colStatus",
                      "colCreatedBy",
                    ].map((k) => (
                      <th key={k} scope="col" className="px-4 py-2 text-start font-medium">
                        {t(k)}
                      </th>
                    ))}
                    <th scope="col" className="px-4 py-2">
                      <span className="sr-only">{t("colActions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-semibold">{r.agencyName}</td>
                      <td className="px-4 py-2">{r.requisition?.title ?? t("anyRole")}</td>
                      <td className="px-4 py-2 font-mono">
                        {t("ofMax", { n: r.submissions, max: r.maxSubmissions })}
                      </td>
                      <td className="px-4 py-2">{formatDate(r.expiresAt)}</td>
                      <td className="px-4 py-2">
                        <Badge variant={TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{r.createdBy ?? "—"}</td>
                      <td className="px-4 py-2 text-end">
                        {r.status === "ACTIVE" || r.status === "LIMIT_REACHED" ? (
                          <ConfirmAction
                            title={t("revokeConfirm")}
                            description={t("revokeHint")}
                            onConfirm={() => revoke.mutate({ id: r.id })}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("revokeFor", { agency: r.agencyName })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </ConfirmAction>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </SectionCard>
      <CareersCap />
      {creating ? (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(agency, url) => setLink({ agency, url })}
        />
      ) : null}
    </div>
  );
}

function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (agency: string, url: string) => void;
}) {
  const t = useTranslations("hiring.sourcing");
  const { options } = useRequisitionOptions();
  const [agency, setAgency] = useState("");
  const [requisitionId, setRequisitionId] = useState("");
  const [days, setDays] = useState("14");
  const [max, setMax] = useState("20");
  const create = useHiringMutation<object, { url: string }>("POST", "/api/hiring/agency-invites", {
    onSuccess: (r) => {
      onCreated(agency.trim(), r.url);
      onClose();
    },
  });
  const postable = options.filter((o) => o.status === "OPEN");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("createTitle")}</DialogTitle>
          <DialogDescription>{t("createHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("agencyName")} htmlFor="ai-name" required>
            <Input
              id="ai-name"
              maxLength={255}
              value={agency}
              onChange={(e) => setAgency(e.target.value)}
            />
          </Field>
          <Field label={t("scope")} htmlFor="ai-req" hint={t("scopeHint")}>
            <NativeSelect
              id="ai-req"
              value={requisitionId}
              onChange={(e) => setRequisitionId(e.target.value)}
            >
              <option value="">{t("anyRole")}</option>
              {postable.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("expiresIn")} htmlFor="ai-days" hint={t("expiresHint")}>
              <Input
                id="ai-days"
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </Field>
            <Field label={t("limit")} htmlFor="ai-max" hint={t("limitHint")}>
              <Input
                id="ai-max"
                type="number"
                min={1}
                max={200}
                value={max}
                onChange={(e) => setMax(e.target.value)}
              />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={create.isPending || !agency.trim()}
            onClick={() =>
              create.mutate({
                agencyName: agency.trim(),
                requisitionId: requisitionId || null,
                expiresInDays: Number(days),
                maxSubmissions: Number(max),
              })
            }
          >
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CareersCap() {
  const t = useTranslations("hiring.sourcing");
  const q = useHiringQuery<{ dailyCapPerRequisition: number; canEdit: boolean }>(
    "/api/hiring/settings/careers",
  );
  const [cap, setCap] = useState<string | null>(null);
  const save = useHiringMutation<{ dailyCapPerRequisition: number }>(
    "PUT",
    "/api/hiring/settings/careers",
    { success: t("capSaved") },
  );
  const value = cap ?? String(q.data?.dailyCapPerRequisition ?? 0);
  return (
    <SectionCard title={t("careersTitle")} subtitle={t("careersHint")}>
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rows={2}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("cap")} htmlFor="cc-cap" hint={t("capHint")}>
            <Input
              id="cc-cap"
              type="number"
              min={0}
              className="w-40"
              readOnly={!q.data?.canEdit}
              value={value}
              onChange={(e) => setCap(e.target.value)}
            />
          </Field>
          {q.data?.canEdit ? (
            <Button
              variant="outline"
              disabled={save.isPending || cap === null}
              onClick={() => save.mutate({ dailyCapPerRequisition: Number(value) })}
            >
              {t("saveCap")}
            </Button>
          ) : (
            <span className="pb-2 text-xs text-muted-foreground">{t("capAdminOnly")}</span>
          )}
        </div>
      </QueryState>
    </SectionCard>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDateTime } from "@/lib/format";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { StatusBadge } from "../ui/badges";
import { Field, Textarea } from "../ui/fields";
import { Notice, QueryState } from "../ui/states";
import type { RequisitionDetail } from "./types";

/**
 * Step 3 — JD sign-off (Interview Hub `JdSignoffClient`, artboards JdApproval /
 * T05). Two named slots on the current version; a send-back bumps the version.
 */
type JdView = {
  jdVersion: number;
  jdStatus: string;
  jdTemplateTitle: string | null;
  description: string;
  competencies: string[];
  advertised: boolean;
  slots: {
    slot: "HIRING_MANAGER" | "HR";
    signed: boolean;
    actorName: string | null;
    at: string | null;
  }[];
  history: {
    id: string;
    version: number;
    action: string;
    signatory: string | null;
    actorName: string;
    comment: string | null;
    createdAt: string;
  }[];
  hrSignerVacant: boolean;
  can: { submit: boolean; sign: ("HIRING_MANAGER" | "HR")[]; requestChanges: boolean };
};

export function JdSignoffView({ id }: { id: string }) {
  const t = useTranslations("hiring.jd");
  const tv = useTranslations("hiring.vacant");
  const locale = useLocale();
  const req = useHiringQuery<RequisitionDetail>(`/api/hiring/requisitions/${id}`);
  const jd = useHiringQuery<JdView>(`/api/hiring/requisitions/${id}/jd`);
  const [changes, setChanges] = useState(false);
  const [comment, setComment] = useState("");
  const act = useHiringMutation<object>("POST", `/api/hiring/requisitions/${id}/jd`, {
    success: t("saved"),
    onSuccess: () => {
      setChanges(false);
      setComment("");
    },
  });
  const v = jd.data;
  const lastChange = v?.history.find((h) => h.action === "CHANGES_REQUESTED");
  return (
    <QueryState isLoading={req.isLoading || jd.isLoading} error={req.error ?? jd.error}>
      {v && req.data ? (
        <div className="space-y-4">
          <PageHeader
            title={t("title", { title: req.data.title })}
            subtitle={t("version", { version: v.jdVersion })}
            actions={
              <>
                <StatusBadge kind="jd" value={v.jdStatus} />
                {v.can.submit ? (
                  <Button
                    onClick={() => act.mutate({ action: "SUBMIT" })}
                    disabled={act.isPending || v.hrSignerVacant}
                  >
                    {t("submit")}
                  </Button>
                ) : null}
              </>
            }
          />
          {v.can.submit && v.hrSignerVacant ? (
            <Notice tone="warning" title={tv("hrSignerTitle")}>
              {tv("hrSignerBody")}{" "}
              <Link
                href={`/${locale}/admin/roles`}
                className="font-medium underline underline-offset-4"
              >
                {tv("openRoles")}
              </Link>
            </Notice>
          ) : null}
          {v.jdStatus === "CHANGES_REQUESTED" && lastChange ? (
            <Notice tone="warning" title={t("changesRequestedBy", { name: lastChange.actorName })}>
              <p className="whitespace-pre-wrap">{lastChange.comment}</p>
            </Notice>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard
              title={t("text")}
              subtitle={
                v.jdTemplateTitle ? t("fromTemplate", { title: v.jdTemplateTitle }) : undefined
              }
              actions={
                req.data.can.manage && v.jdStatus !== "AWAITING_SIGNOFF" ? (
                  <Link
                    href={`/${locale}/hiring/requisitions/${id}/edit`}
                    className="text-sm text-primary-emphasis hover:underline"
                  >
                    {t("editJd")}
                  </Link>
                ) : null
              }
            >
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {v.description || t("empty")}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">{v.competencies.join(" · ")}</p>
            </SectionCard>
            <div className="space-y-4 lg:col-span-2">
              <SectionCard
                title={t("signatories")}
                subtitle={v.advertised ? t("advertised") : t("notAdvertised")}
              >
                <ul className="space-y-3">
                  {v.slots.map((s) => (
                    <li
                      key={s.slot}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                    >
                      <div className="text-sm">
                        <p className="font-medium text-foreground">{t(`slot.${s.slot}`)}</p>
                        <p className="text-muted-foreground">
                          {s.signed
                            ? t("signedBy", {
                                name: s.actorName ?? "—",
                                date: s.at ? formatDateTime(s.at) : "",
                              })
                            : t("pending")}
                        </p>
                      </div>
                      {v.can.sign.includes(s.slot) ? (
                        <Button
                          size="sm"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ action: "SIGN", signatory: s.slot })}
                        >
                          {t("approve")}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {v.can.requestChanges ? (
                  <Button variant="outline" className="mt-3" onClick={() => setChanges(true)}>
                    {t("requestChanges")}
                  </Button>
                ) : null}
              </SectionCard>
              <SectionCard title={t("history")}>
                {v.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
                ) : null}
                <ul className="space-y-2">
                  {v.history.map((h) => (
                    <li key={h.id} className="text-sm">
                      <span className="text-foreground">
                        {t(`action.${h.action}`)}{" "}
                        {h.signatory ? `· ${t(`slot.${h.signatory}`)}` : ""}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        · {h.actorName} · {t("versionShort", { version: h.version })} ·{" "}
                        {formatDateTime(h.createdAt)}
                      </span>
                      {h.comment ? (
                        <p className="whitespace-pre-wrap text-muted-foreground">{h.comment}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </SectionCard>
            </div>
          </div>
          <Dialog open={changes} onOpenChange={setChanges}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("requestChanges")}</DialogTitle>
              </DialogHeader>
              <Field label={t("whatShouldChange")} htmlFor="jd-change">
                <Textarea
                  id="jd-change"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </Field>
              <DialogFooter>
                <Button variant="outline" onClick={() => setChanges(false)}>
                  {t("cancel")}
                </Button>
                <Button
                  disabled={!comment.trim() || act.isPending}
                  onClick={() => act.mutate({ action: "REQUEST_CHANGES", comment })}
                >
                  {t("sendBack")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
    </QueryState>
  );
}

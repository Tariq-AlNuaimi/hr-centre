"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button-variants";
import { formatDateTime } from "@/lib/format";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { StatusBadge } from "../ui/badges";
import { Field, Textarea } from "../ui/fields";
import { Notice } from "../ui/states";
import type { NeedRow, RoundView } from "./types";

/** One department's requirement: record it, challenge it, raise it (W01 drawer). */
type Note = {
  id: string;
  authorName: string;
  authorRole: string | null;
  body: string;
  createdAt: string;
};

export function NeedDialog({
  need,
  round,
  onClose,
}: {
  need: NeedRow;
  round: RoundView;
  onClose: () => void;
}) {
  const t = useTranslations("hiring.planning");
  const locale = useLocale();
  const editable = round.canManage && round.status === "OPEN";
  const [requested, setRequested] = useState(need.rolesRequested?.toString() ?? "");
  const [agreed, setAgreed] = useState(need.agreedRoles?.toString() ?? "");
  const [body, setBody] = useState("");
  const notes = useHiringQuery<Note[]>(`/api/hiring/needs/${need.id}/notes`);
  const patch = useHiringMutation<object>("PATCH", `/api/hiring/needs/${need.id}`, {
    success: t("recorded"),
  });
  const post = useHiringMutation<object>("POST", `/api/hiring/needs/${need.id}/notes`, {
    onSuccess: () => setBody(""),
  });
  const n = (v: string) => (v === "" ? null : Number(v));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{need.department}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-2">
            <StatusBadge kind="need" value={need.status} />
            <span className="text-muted-foreground">{need.owner?.name ?? t("noOwner")}</span>
          </div>
          {editable ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Field label={t("recordSubmitted")} htmlFor="nd-req">
                  <Input
                    id="nd-req"
                    type="number"
                    min={0}
                    max={999}
                    value={requested}
                    onChange={(e) => setRequested(e.target.value)}
                  />
                </Field>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={requested === ""}
                  onClick={() =>
                    patch.mutate({ status: "SUBMITTED", rolesRequested: n(requested) })
                  }
                >
                  {t("saveSubmitted")}
                </Button>
              </div>
              <div className="space-y-2">
                <Field label={t("recordOutcome")} htmlFor="nd-agreed">
                  <Input
                    id="nd-agreed"
                    type="number"
                    min={0}
                    max={999}
                    value={agreed}
                    onChange={(e) => setAgreed(e.target.value)}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={agreed === ""}
                    onClick={() =>
                      patch.mutate({ status: "CHALLENGE_AGREED", agreedRoles: n(agreed) })
                    }
                  >
                    {t("saveAgreed")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      patch.mutate({
                        status: "NO_NEED",
                        rolesRequested: n(requested) ?? 0,
                        agreedRoles: 0,
                      })
                    }
                  >
                    {t("noNeed")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          {need.blockedReason ? (
            <Notice tone="info">{need.blockedReason}</Notice>
          ) : round.canManage ? (
            <Link
              className={buttonVariants({})}
              href={`/${locale}/hiring/requisitions/request?need=${need.id}`}
            >
              {t("raise")}
            </Link>
          ) : null}
          <div>
            <p className="font-medium text-foreground">{t("thread")}</p>
            <ul className="mt-2 max-h-64 space-y-2 overflow-auto">
              {(notes.data ?? []).map((x) => (
                <li key={x.id} className="rounded-md border border-border p-2">
                  <p className="text-xs text-muted-foreground">
                    {x.authorName}
                    {x.authorRole ? ` · ${x.authorRole}` : ""} · {formatDateTime(x.createdAt)}
                  </p>
                  <p className="whitespace-pre-wrap text-foreground">{x.body}</p>
                </li>
              ))}
              {notes.data?.length === 0 ? (
                <li className="text-muted-foreground">{t("noNotes")}</li>
              ) : null}
            </ul>
            {editable ? (
              <div className="mt-2 space-y-2">
                <Textarea
                  aria-label={t("addNote")}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={!body.trim() || post.isPending}
                  onClick={() => post.mutate({ body })}
                >
                  {t("postNote")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

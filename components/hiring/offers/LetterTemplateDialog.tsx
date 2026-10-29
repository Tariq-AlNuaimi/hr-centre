"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { Field, Textarea } from "@/components/shared/FormControls";
import { QueryState } from "../ui/states";

type Template = {
  body: string;
  isDefault: boolean;
  defaultBody: string;
  mergeFields: string[];
  canEdit: boolean;
};

/** The offer letter's opening paragraph (`offerLetter.template`). HR reads it; a hiring admin edits it. */
export function LetterTemplateDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("hiring.offers");
  const q = useHiringQuery<Template>("/api/hiring/settings/offer-letter");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("templateTitle")}</DialogTitle>
          <DialogDescription>{t("templateHint")}</DialogDescription>
        </DialogHeader>
        <QueryState
          isLoading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rows={4}
        >
          {q.data ? <Editor tpl={q.data} onClose={onClose} /> : null}
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}

function Editor({ tpl, onClose }: { tpl: Template; onClose: () => void }) {
  const t = useTranslations("hiring.offers");
  const [body, setBody] = useState(tpl.body);
  const save = useHiringMutation<{ body: string }>("PUT", "/api/hiring/settings/offer-letter", {
    success: t("templateSaved"),
    onSuccess: onClose,
  });
  return (
    <div className="space-y-3">
      <Field
        label={t("templateBody")}
        htmlFor="lt-body"
        hint={t("mergeFields", { fields: tpl.mergeFields.map((f) => `[${f}]`).join(" ") })}
      >
        <Textarea
          id="lt-body"
          rows={10}
          maxLength={20_000}
          readOnly={!tpl.canEdit}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>
      {!tpl.canEdit ? (
        <p className="text-xs text-muted-foreground">{t("templateAdminOnly")}</p>
      ) : null}
      <DialogFooter>
        {tpl.canEdit ? (
          <Button
            variant="ghost"
            onClick={() => setBody(tpl.defaultBody)}
            disabled={body === tpl.defaultBody}
          >
            {t("templateReset")}
          </Button>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          {t("close")}
        </Button>
        {tpl.canEdit ? (
          <Button
            disabled={save.isPending || !body.trim() || body === tpl.body}
            onClick={() => save.mutate({ body })}
          >
            {t("templateSave")}
          </Button>
        ) : null}
      </DialogFooter>
    </div>
  );
}

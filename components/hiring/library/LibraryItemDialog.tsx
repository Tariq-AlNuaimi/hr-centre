"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/org/NativeSelect";
import { useHiringMutation } from "../ui/api";
import { CompetencyPicker } from "../ui/competency-picker";
import { Field, Textarea } from "../ui/fields";
import { Notice } from "../ui/states";
import { LIBRARY_FIELDS, type FieldDef } from "./config";
import type { LibraryRow } from "./LibraryView";

/** Create / edit one knowledge-base entry. */
export function LibraryItemDialog({
  kind,
  item,
  onClose,
}: {
  kind: string;
  item: LibraryRow | null;
  onClose: () => void;
}) {
  const t = useTranslations("hiring.library");
  const fields = LIBRARY_FIELDS[kind];
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.name,
        item?.[f.name] ?? (f.type === "competencies" ? [] : f.type === "anchors" ? {} : ""),
      ]),
    ),
  );
  const path = item ? `/api/hiring/library/${kind}/${item.id}` : `/api/hiring/library/${kind}`;
  const save = useHiringMutation<object>(item ? "PUT" : "POST", path, {
    success: t("saved"),
    onSuccess: onClose,
  });
  const set = (name: string, v: unknown) => setValues((x) => ({ ...x, [name]: v }));
  const payload = Object.fromEntries(
    fields.map((f) => {
      const v = values[f.name];
      if (f.type === "number") return [f.name, v === "" || v === null ? null : Number(v)];
      if (f.type === "text" || f.type === "textarea" || f.type === "select")
        return [f.name, v === "" ? null : v];
      return [f.name, v];
    }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item ? t(`editTitle.${kind}`) : t(`new.${kind}`)}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-auto">
          {fields.map((f) => (
            <FieldInput
              key={f.name}
              f={f}
              value={values[f.name]}
              onChange={(v) => set(f.name, v)}
            />
          ))}
        </div>
        {save.error ? <Notice tone="danger">{save.error.message}</Notice> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate(payload)}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldInput({
  f,
  value,
  onChange,
}: {
  f: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const t = useTranslations("hiring.library");
  const id = `lib-${f.name}`;
  const label = t(`field.${f.name}`);
  if (f.type === "competencies") {
    return (
      <Field label={label}>
        <CompetencyPicker value={(value as string[]) ?? []} onChange={onChange} />
      </Field>
    );
  }
  if (f.type === "anchors") {
    const anchors = (value as Record<string, string>) ?? {};
    return (
      <Field label={label} hint={t("anchorsHint")}>
        <div className="space-y-2">
          {["1", "2", "3", "4", "5"].map((n) => (
            <Input
              key={n}
              aria-label={t("anchorLevel", { n })}
              placeholder={t("anchorLevel", { n })}
              value={anchors[n] ?? ""}
              onChange={(e) => onChange({ ...anchors, [n]: e.target.value })}
            />
          ))}
        </div>
      </Field>
    );
  }
  if (f.type === "select") {
    return (
      <Field label={label} htmlFor={id} required={f.required}>
        <NativeSelect
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{t("choose")}</option>
          {f.options?.map((o) => (
            <option key={o} value={o}>
              {t(`option.${o}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
    );
  }
  return (
    <Field label={label} htmlFor={id} required={f.required}>
      {f.type === "textarea" ? (
        <Textarea id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input
          id={id}
          type={f.type === "number" ? "number" : "text"}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, Check, Pencil, Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { OutcomeCaptureRow } from "@/lib/services/calibration";

type Tri = "yes" | "no" | "unknown";
const triToBool = (t: Tri): boolean | null => (t === "yes" ? true : t === "no" ? false : null);
const boolToTri = (b: boolean | null): Tri => (b === true ? "yes" : b === false ? "no" : "unknown");
const ratingToStr = (n: number | null): string => (n === null ? "" : String(n));

// Outcome capture/edit form (UI-SPEC D.9). A right-anchored Sheet (RTL-mirrored):
// the hire gate plus the post-hire signals, which are disabled until "Hired" so the
// non-hire invariant the server enforces is also reflected in the UI. Honest async
// states; the server re-validates. Tri-state pickers (yes/no/not-yet) keep "unknown"
// distinct from "no" — outcomes accrue over time.
export function OutcomeForm({ row }: { row: OutcomeCaptureRow }) {
  const t = useTranslations("calibration");
  const router = useRouter();
  const o = row.outcome;
  const [open, setOpen] = React.useState(false);

  const [hired, setHired] = React.useState<boolean>(o?.hired ?? true);
  const [probation, setProbation] = React.useState<Tri>(boolToTri(o?.probationPassed ?? null));
  const [retained, setRetained] = React.useState<Tri>(boolToTri(o?.retained ?? null));
  const [rating6m, setRating6m] = React.useState<string>(ratingToStr(o?.rating6m ?? null));
  const [rating12m, setRating12m] = React.useState<string>(ratingToStr(o?.rating12m ?? null));

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset the form to the row's current state whenever the sheet (re)opens.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setHired(o?.hired ?? true);
      setProbation(boolToTri(o?.probationPassed ?? null));
      setRetained(boolToTri(o?.retained ?? null));
      setRating6m(ratingToStr(o?.rating6m ?? null));
      setRating12m(ratingToStr(o?.rating12m ?? null));
      setError(null);
    }
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/calibration/outcomes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resultId: row.resultId,
          hired,
          // Post-hire signals are only meaningful for a hire (server enforces this too).
          probationPassed: hired ? triToBool(probation) : null,
          retained: hired ? triToBool(retained) : null,
          rating6m: hired && rating6m ? Number(rating6m) : null,
          rating12m: hired && rating12m ? Number(rating12m) : null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? t("saveError"));
        setSaving(false);
        return;
      }
      setSaving(false);
      setOpen(false);
      router.refresh();
    } catch {
      setError(t("saveError"));
      setSaving(false);
    }
  }

  const candidate = row.candidateName || row.candidateEmail;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          {o ? <Pencil className="size-3.5" /> : <Plus className="size-3.5" />}
          {o ? t("edit") : t("record")}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[420px] gap-0 overflow-y-auto">
        <SheetTitle className="text-base">{o ? t("formTitleEdit") : t("formTitleNew")}</SheetTitle>
        <SheetDescription>
          {t("formSubtitle", { candidate, role: row.roleTitle })}
        </SheetDescription>

        <div className="mt-4 flex flex-col gap-5">
          {/* Hire gate */}
          <fieldset className="flex flex-col gap-1.5">
            <Label asChild>
              <legend>{t("hired")}</legend>
            </Label>
            <div role="radiogroup" aria-label={t("hired")} className="inline-flex rounded-md border border-border p-0.5">
              {([true, false] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  role="radio"
                  aria-checked={hired === v}
                  onClick={() => setHired(v)}
                  className={
                    "rounded px-3 py-1 text-sm transition-colors " +
                    (hired === v
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {v ? t("hiredYes") : t("hiredNo")}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Post-hire signals */}
          <fieldset className="flex flex-col gap-4" disabled={!hired}>
            <legend className="text-sm font-medium text-foreground">{t("postHireLegend")}</legend>
            <p className="-mt-2 text-xs text-muted-foreground">
              {hired ? t("postHireNote") : t("nonHiredNote")}
            </p>

            <TriField label={t("probation")} value={probation} onChange={setProbation} t={t} />
            <TriField label={t("retained")} value={retained} onChange={setRetained} t={t} />

            <div className="grid grid-cols-2 gap-3">
              <RatingField id="rating6m" label={t("rating6m")} value={rating6m} onChange={setRating6m} t={t} />
              <RatingField id="rating12m" label={t("rating12m")} value={rating12m} onChange={setRating12m} t={t} />
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-[var(--signal-below-ink)]">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pb-2">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {saving ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TriField({
  label,
  value,
  onChange,
  t,
}: {
  label: string;
  value: Tri;
  onChange: (v: Tri) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const opts: { v: Tri; label: string }[] = [
    { v: "yes", label: t("triYes") },
    { v: "no", label: t("triNo") },
    { v: "unknown", label: t("triUnknown") },
  ];
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-foreground">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-border p-0.5">
        {opts.map((opt) => (
          <button
            key={opt.v}
            type="button"
            role="radio"
            aria-checked={value === opt.v}
            onClick={() => onChange(opt.v)}
            className={
              "rounded px-2.5 py-1 text-xs transition-colors " +
              (value === opt.v
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RatingField({
  id,
  label,
  value,
  onChange,
  t,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm text-muted-foreground">
        {label}
      </Label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("ratingNone")}</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={String(n)}>
            {t("ratingValue", { n })}
          </option>
        ))}
      </Select>
    </div>
  );
}

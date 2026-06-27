"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, Check } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

// Org profile form (UI-SPEC D.10): name + default candidate language. PUTs to the
// org settings route; honest async states.
export function OrgProfileForm({ name, defaultLocale }: { name: string; defaultLocale: string }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [orgName, setOrgName] = React.useState(name);
  const [locale, setLocale] = React.useState(defaultLocale === "ar" ? "ar" : "en");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  async function save() {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch("/api/settings/org", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: orgName, defaultLocale: locale }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? t("saveError"));
        setSaving(false);
        return;
      }
      setSaving(false);
      setSaved(true);
      router.refresh();
    } catch {
      setError(t("saveError"));
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-name">{t("orgName")}</Label>
        <Input id="org-name" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-lang">{t("defaultLanguage")}</Label>
        <Select id="org-lang" value={locale} onChange={(e) => setLocale(e.target.value === "ar" ? "ar" : "en")}>
          <option value="en">{t("langEn")}</option>
          <option value="ar">{t("langAr")}</option>
        </Select>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving || orgName.trim() === ""}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {saving ? t("saving") : t("save")}
        </Button>
        {saved && !error && (
          <span role="status" className="text-sm text-[var(--signal-pass-ink)]">
            {t("saved")}
          </span>
        )}
        {error && (
          <span role="alert" className="text-sm text-[var(--signal-below-ink)]">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Send, Upload, Loader2, Check, CircleAlert } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  parseRecipients,
  MAX_BATCH,
  type RecipientResult,
} from "@/lib/validations/invitation";

type RoleProfileOption = {
  id: string;
  title: string;
  version: number;
  roleFamily: { name: string };
};

type Mode = "single" | "bulk";
const EXPIRY_DAYS = [7, 14, 30, 90] as const;

// Send panel (UI-SPEC D.5). A right-anchored Sheet (RTL-mirrored) with a Single /
// Bulk toggle. Bulk parses paste/CSV client-side (lib/validations parseRecipients)
// into a deduped, validated preview before confirm; the server re-validates. Honest
// states throughout: per-recipient results, no green toast over a failed send.
export function SendInvitesPanel({
  roleProfiles,
}: {
  roleProfiles: RoleProfileOption[];
}) {
  const t = useTranslations("invitations.panel");
  const tInv = useTranslations("invitations");
  const tLang = useTranslations("invitations.lang");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>("single");

  const hasRoles = roleProfiles.length > 0;
  const [roleProfileId, setRoleProfileId] = React.useState(roleProfiles[0]?.id ?? "");
  const [expiresDays, setExpiresDays] = React.useState<string>(""); // "" = never
  const [locale, setLocale] = React.useState<"en" | "ar">("en");
  const [message, setMessage] = React.useState("");

  // Single
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");

  // Bulk
  const [rawText, setRawText] = React.useState("");
  const parse = React.useMemo(() => parseRecipients(rawText), [rawText]);

  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<RecipientResult[] | null>(null);
  const [singleDone, setSingleDone] = React.useState(false);

  const expiresInDays = expiresDays === "" ? null : Number(expiresDays);

  function resetResults() {
    setResults(null);
    setSingleDone(false);
    setError(null);
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setRawText(String(reader.result ?? ""));
    reader.readAsText(file);
    e.target.value = ""; // allow re-upload of the same file
  }

  async function submit() {
    resetResults();
    if (!roleProfileId) {
      setError(t("validationFix"));
      return;
    }
    setSending(true);
    try {
      if (mode === "single") {
        const res = await fetch("/api/invitations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            roleProfileId,
            email,
            name: name || undefined,
            expiresInDays,
            locale,
            message: message || undefined,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          data?: RecipientResult;
          error?: string;
        };
        if (!res.ok) {
          setError(body.error ?? t("validationFix"));
          return;
        }
        setSingleDone(true);
        setResults(body.data ? [body.data] : []);
        setEmail("");
        setName("");
        router.refresh();
      } else {
        const res = await fetch("/api/invitations/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            roleProfileId,
            recipients: parse.recipients,
            expiresInDays,
            locale,
            message: message || undefined,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          data?: { results: RecipientResult[] };
          error?: string;
        };
        if (!res.ok) {
          setError(body.error ?? t("validationFix"));
          return;
        }
        setResults(body.data?.results ?? []);
        setRawText("");
        router.refresh();
      }
    } catch {
      setError(t("validationFix"));
    } finally {
      setSending(false);
    }
  }

  const overLimit = parse.recipients.length > MAX_BATCH;
  const submitDisabled =
    sending ||
    !hasRoles ||
    !roleProfileId ||
    (mode === "single"
      ? email.trim() === ""
      : parse.recipients.length === 0 || overLimit);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetResults();
      }}
    >
      <SheetTrigger asChild>
        <Button>
          <Send className="size-4" />
          {tInv("send")}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[460px] gap-0 overflow-y-auto"
      >
        <SheetTitle className="text-base">{t("title")}</SheetTitle>
        <SheetDescription>{t("description")}</SheetDescription>

        {/* Mode toggle — a segmented button group (not an ARIA tabs widget, which
            would need tabpanel wiring + arrow-key nav we don't implement). */}
        <div
          role="group"
          aria-label={t("title")}
          className="mt-4 inline-flex rounded-md border border-border p-0.5"
        >
          {(["single", "bulk"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                resetResults();
              }}
              className={
                "rounded px-3 py-1 text-sm transition-colors " +
                (mode === m
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {m === "single" ? t("tabSingle") : t("tabBulk")}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {/* Role profile */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-role">{t("role")}</Label>
            {hasRoles ? (
              <Select
                id="inv-role"
                value={roleProfileId}
                onChange={(e) => setRoleProfileId(e.target.value)}
              >
                {roleProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.roleFamily.name} — {p.title} (v{p.version})
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-sm text-[var(--signal-partial-ink)]">
                {t("noActiveRoles")}
              </p>
            )}
          </div>

          {mode === "single" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-email">{t("email")}</Label>
                <Input
                  id="inv-email"
                  type="email"
                  value={email}
                  placeholder={t("emailPlaceholder")}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-name">{t("name")}</Label>
                <Input
                  id="inv-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="inv-recipients">{t("recipients")}</Label>
                <Button asChild variant="ghost" size="sm" className="h-7">
                  <label className="cursor-pointer">
                    <Upload className="size-3.5" />
                    {t("upload")}
                    <input
                      type="file"
                      accept=".csv,text/csv,text/plain"
                      className="sr-only"
                      onChange={onUpload}
                    />
                  </label>
                </Button>
              </div>
              <Textarea
                id="inv-recipients"
                value={rawText}
                rows={6}
                placeholder={t("recipientsPlaceholder")}
                onChange={(e) => setRawText(e.target.value)}
                aria-describedby="inv-recipients-help"
              />
              <p id="inv-recipients-help" className="text-xs text-muted-foreground">
                {t("recipientsHelp")}
              </p>
              {rawText.trim() !== "" && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-medium text-[var(--signal-pass-ink)]">
                    {t("previewValid", { count: parse.recipients.length })}
                  </span>
                  {parse.duplicates > 0 && (
                    <span className="text-muted-foreground">
                      {t(
                        parse.duplicates === 1
                          ? "previewDuplicates"
                          : "previewDuplicatesPlural",
                        { count: parse.duplicates }
                      )}
                    </span>
                  )}
                  {parse.invalid.length > 0 && (
                    <span className="text-[var(--signal-below-ink)]">
                      {t("previewInvalid", { count: parse.invalid.length })}
                    </span>
                  )}
                  {parse.recipients.length === 0 && parse.invalid.length === 0 && (
                    <span className="text-muted-foreground">{t("previewNone")}</span>
                  )}
                </div>
              )}
              {parse.invalid.length > 0 && (
                <p className="text-xs text-[var(--signal-below-ink)]">
                  {t("invalidList", {
                    list: parse.invalid.slice(0, 5).join(", ") + (parse.invalid.length > 5 ? "…" : ""),
                  })}
                </p>
              )}
              {overLimit && (
                <p className="text-xs text-[var(--signal-below-ink)]">
                  {t("previewOverLimit", {
                    max: MAX_BATCH,
                    count: parse.recipients.length - MAX_BATCH,
                  })}
                </p>
              )}
            </div>
          )}

          {/* Shared options */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-expiry">{t("expiry")}</Label>
              <Select
                id="inv-expiry"
                value={expiresDays}
                onChange={(e) => setExpiresDays(e.target.value)}
              >
                <option value="">{t("expiryNever")}</option>
                {EXPIRY_DAYS.map((d) => (
                  <option key={d} value={String(d)}>
                    {t("expiryDays", { days: d })}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-lang">{t("language")}</Label>
              <Select
                id="inv-lang"
                value={locale}
                onChange={(e) => setLocale(e.target.value === "ar" ? "ar" : "en")}
              >
                <option value="en">{tLang("en")}</option>
                <option value="ar">{tLang("ar")}</option>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-message">{t("message")}</Label>
            <Textarea
              id="inv-message"
              value={message}
              rows={2}
              placeholder={t("messagePlaceholder")}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-[var(--signal-below-ink)]">
              {error}
            </p>
          )}

          {/* Results */}
          {results && (
            <div className="rounded-md border border-border bg-secondary/40 p-3">
              <p className="mb-2 text-sm font-medium text-foreground">
                {t("resultsTitle")}
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {results.map((r, i) => (
                  <li key={`${r.email}-${i}`} className="flex items-center gap-2">
                    <ResultIcon outcome={r.outcome} />
                    <span className="truncate text-foreground">{r.email}</span>
                    <span className="ms-auto text-xs text-muted-foreground">
                      {t(
                        r.outcome === "sent"
                          ? "resultSent"
                          : r.outcome === "created"
                            ? "resultCreated"
                            : r.outcome === "skipped"
                              ? "resultSkipped"
                              : "resultFailed"
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {results.some((r) => r.outcome === "created") && (
                <p className="mt-2 text-xs text-[var(--signal-partial-ink)]">
                  {t("emailDisabledNote")}
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pb-2">
            {singleDone && !error && (
              <span className="me-auto inline-flex items-center gap-1 text-sm text-[var(--signal-pass-ink)]">
                <Check className="size-4" /> {t("resultSent")}
              </span>
            )}
            <Button onClick={submit} disabled={submitDisabled}>
              {sending && <Loader2 className="size-4 animate-spin" />}
              {sending
                ? t("sending")
                : mode === "single"
                  ? t("sendSingle")
                  : t("sendBulk", { count: parse.recipients.length })}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ResultIcon({ outcome }: { outcome: RecipientResult["outcome"] }) {
  if (outcome === "sent" || outcome === "created") {
    return <Check className="size-4 shrink-0 text-[var(--signal-pass-ink)]" aria-hidden />;
  }
  if (outcome === "skipped") {
    return <CircleAlert className="size-4 shrink-0 text-[var(--signal-partial-ink)]" aria-hidden />;
  }
  return <CircleAlert className="size-4 shrink-0 text-[var(--signal-below-ink)]" aria-hidden />;
}

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Paperclip, Link2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/api-client";
import { useNotify } from "@/hooks/use-notify";
import { formatDateTime } from "@/lib/format";
import {
  ALLOWED_EVIDENCE_TYPES,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_PER_KPI,
  isAllowedContentType,
} from "@/lib/pms/evidence";

/**
 * §7.1 evidence, per KPI (operator requirement, 2026-10-20).
 *
 * Required: the employee cannot sign until every KPI carries at least one
 * item. This component says so BEFORE they try, but it is not what enforces
 * it — `signBlockedReason` does, on the write. A disabled button is a courtesy;
 * the gate is in the route.
 *
 * Read-only for everyone except the owner, and the owner only until they sign.
 * A FILE never carries a URL in this payload: there is no public one, and a
 * signed URL minted at render time would outlive the check that authorised it,
 * so opening an item is a round trip through `/api/year-end/evidence/[id]`.
 */

export interface EvidenceItem {
  id: string;
  kind: "FILE" | "LINK";
  label: string;
  url: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
  managerComment: string | null;
  managerCommentAt: string | null;
}

/**
 * Both the MIME types AND the extensions.
 *
 * MIME types alone is a silent failure, and it was almost certainly the one the
 * operator hit: the OS decides whether a file matches `text/markdown` or
 * `text/csv`, and on most machines a `.md` or `.csv` simply greys out in the
 * picker. The dialog opens, nothing can be chosen, `onChange` never fires, and
 * the page has no idea anything happened — "the file picker opens and nothing
 * happens", with no error anywhere because no code ran.
 */
const ACCEPT = [
  ...Object.keys(ALLOWED_EVIDENCE_TYPES),
  ...Object.values(ALLOWED_EVIDENCE_TYPES)
    .flat()
    .map((e) => `.${e}`),
].join(",");

/**
 * What type IS this file, as far as the allowlist is concerned?
 *
 * `File.type` is the browser's guess from the OS, and it is routinely wrong or
 * absent for exactly the formats people attach as evidence: `.md` usually
 * arrives as `""`, and `.csv` as `application/vnd.ms-excel` on a machine with
 * Excel installed. The server's schema is a strict enum, so taking `file.type`
 * at face value refuses a perfectly good file with a message about its type.
 *
 * So the extension decides when the browser's guess is not on the allowlist.
 * This is NOT trusting the extension: the server reads the stored file's own
 * magic bytes before a row exists, and a mismatch is deleted. All this does is
 * pick which claim gets checked.
 */
function declaredType(file: File): string | null {
  if (isAllowedContentType(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  for (const [type, exts] of Object.entries(ALLOWED_EVIDENCE_TYPES)) {
    if ((exts as readonly string[]).includes(ext)) return type;
  }
  return null;
}

/**
 * One line of the visible progress log.
 *
 * On the page, in plain words, and it STAYS there until the next attempt — the
 * operator cannot read a browser console, and a toast that has already faded is
 * no better than silence. Every step reports its own outcome, so "nothing
 * happened" becomes "this step, this reason, this status".
 */
type StepState = "running" | "ok" | "failed";
interface Step {
  label: string;
  state: StepState;
  /** The exact server sentence, HTTP status, or browser error text. */
  detail?: string;
}

function StepList({ steps }: { steps: Step[] }) {
  const t = useTranslations("pms.evidence");
  if (steps.length === 0) return null;
  const failed = steps.some((s) => s.state === "failed");
  return (
    <div
      className={`mt-3 rounded-md border p-3 text-xs ${
        failed ? "border-destructive/50 bg-destructive/5" : "border-border bg-muted/30"
      }`}
      // Announced, so the outcome reaches a screen-reader user too rather than
      // only appearing for anyone watching that corner of the page.
      role="status"
      aria-live="polite"
    >
      <p className="mb-2 font-medium">{t("progressTitle")}</p>
      <ol className="space-y-1">
        {steps.map((step, i) => (
          <li key={`${step.label}-${i}`} className="flex gap-2">
            <span aria-hidden className="shrink-0">
              {step.state === "ok" ? "✓" : step.state === "failed" ? "✕" : "…"}
            </span>
            <span className="min-w-0">
              <span className={step.state === "failed" ? "font-medium text-destructive" : ""}>
                {step.label}
              </span>
              {step.detail ? (
                // `break-words`: an error can be a long URL or a CSP sentence,
                // and a message that overflows its box is another way of being
                // invisible.
                <span className="block break-words text-muted-foreground">{step.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The exact text and status behind a failure, whatever threw it. */
function describe(e: unknown): string {
  if (e instanceof ApiError) return `HTTP ${e.status} — ${e.message}`;
  if (e instanceof Error) {
    // A fetch blocked by CSP, or one that never reached the network, reports
    // only "Failed to fetch" / "Load failed" with no detail anywhere the page
    // can see. Naming the likely cause is the whole diagnosis.
    if (/failed to fetch|load failed|networkerror/i.test(e.message)) {
      return `${e.name}: ${e.message} — the browser could not reach the storage host at all. This is usually the Content-Security-Policy connect-src directive, or no network route to it.`;
    }
    return `${e.name}: ${e.message}`;
  }
  return String(e);
}

function sizeLabel(bytes: number | null): string | null {
  if (bytes === null) return null;
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function KpiEvidence({
  kpiId,
  items,
  canEdit,
  canComment,
  storageConfigured,
}: {
  kpiId: string;
  /**
   * No `participantId`, deliberately. The browser proposes the pathname in
   * Vercel's protocol, and for one release this component built it from the
   * participant id — which is how it came to send a prefix the server's own pin
   * could never accept, with nothing type-checking the two against each other.
   * The server now RETURNS the pathname it will authorise and this component
   * echoes it back, so there is one author of that string and nothing left to
   * disagree about.
   */
  items: EvidenceItem[];
  /** The owner, before they sign. */
  canEdit: boolean;
  /** The direct line manager, reviewing. */
  canComment: boolean;
  /** Files need a Blob store; links never do. */
  storageConfigured: boolean;
}) {
  const t = useTranslations("pms.evidence");
  const router = useRouter();
  const queryClient = useQueryClient();

  /**
   * Make a saved change VISIBLE, on either host page.
   *
   * Two different mechanisms, and using only one was a second reason evidence
   * "didn't appear": the manager's participant page is a server component that
   * `router.refresh()` re-renders, but the employee's own page
   * (`MyYearEnd`) reads `/api/year-end/me` through TanStack Query, which
   * `router.refresh()` does not touch at all. So an item could save correctly —
   * row written, audit row written — and never show up until a manual reload,
   * which from the outside is indistinguishable from the save having failed.
   */
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: ["pms", "year-end"] });
    router.refresh();
  };
  const { success, error: showError } = useNotify();
  const fileInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);

  const full = items.length >= MAX_EVIDENCE_PER_KPI;

  function fail(e: unknown, fallback: string) {
    showError(e instanceof ApiError ? e.message : fallback);
  }

  async function open(item: EvidenceItem) {
    // A link is already a URL. A file needs the round trip that checks §4.2 and
    // then hands back a short-lived signed URL.
    if (item.kind === "LINK" && item.url) {
      window.open(item.url, "_blank", "noopener,noreferrer");
      return;
    }
    window.open(`/api/year-end/evidence/${item.id}`, "_blank", "noopener,noreferrer");
  }

  async function attachLink() {
    setBusy(true);
    try {
      await apiClient.post("/api/year-end/evidence", {
        kpiId,
        label: linkLabel.trim(),
        url: linkUrl.trim(),
      });
      setLinkLabel("");
      setLinkUrl("");
      setShowLink(false);
      success(t("linkAdded"));
      reload();
    } catch (e) {
      fail(e, t("addFailed"));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Attach a file, narrating every step on the page.
   *
   * Written as an explicit sequence rather than one try/catch because the
   * operator's report was "the picker opens and nothing happens" — and the
   * honest answer was that several things could end this function without
   * leaving a trace anyone could see. Each step now says it started, and says
   * how it ended, with the server's own sentence and HTTP status.
   */
  async function attachFile(file: File) {
    setBusy(true);
    const log: Step[] = [];
    // Pushed into state after every change: the log has to appear AS it
    // happens, not after the whole thing settles, or a step that hangs looks
    // identical to a step that never ran.
    const show = () => setSteps([...log]);
    const begin = (label: string) => {
      log.push({ label, state: "running" });
      show();
    };
    const done = (detail?: string) => {
      log[log.length - 1] = { ...log[log.length - 1], state: "ok", detail };
      show();
    };
    const failHere = (detail: string) => {
      log[log.length - 1] = { ...log[log.length - 1], state: "failed", detail };
      show();
    };

    try {
      begin(t("stepChoosing"));
      done(
        t("stepChosen", {
          name: file.name,
          size: sizeLabel(file.size) ?? `${file.size} B`,
          // What the BROWSER said, verbatim — including empty, which is the
          // normal answer for `.md` and worth seeing rather than guessing at.
          type: file.type === "" ? t("noTypeReported") : file.type,
        }),
      );

      begin(t("stepCheckingType"));
      const contentType = declaredType(file);
      if (contentType === null) {
        failHere(
          t("typeNotAccepted", { types: Object.values(ALLOWED_EVIDENCE_TYPES).flat().join(", ") }),
        );
        return;
      }
      done(t("stepTypeAccepted", { type: contentType }));

      begin(t("stepCheckingSize"));
      if (file.size > MAX_EVIDENCE_BYTES) {
        failHere(t("tooLarge", { limit: MAX_EVIDENCE_BYTES / 1024 / 1024 }));
        return;
      }
      if (file.size === 0) {
        failHere(t("stepEmptyFile"));
        return;
      }
      done();

      // ASK FIRST. Every rule is also enforced on the token, but a refusal
      // thrown there comes back through the Blob SDK, which replaces our
      // sentence with its own — which is exactly why the last failure was
      // invisible. This asks in our own envelope, so the reason and the status
      // reach the screen. It also returns the pathname the server will
      // authorise, so the client cannot propose one the server's pin refuses.
      begin(t("stepRequestingPermission"));
      let pathname: string;
      try {
        const res = await apiClient.post<{ pathname: string; remaining: number }>(
          "/api/year-end/evidence",
          { preflight: true, kpiId, contentType, sizeBytes: file.size },
        );
        pathname = res.pathname;
        done(t("stepPermissionGranted", { remaining: res.remaining }));
      } catch (e) {
        failHere(describe(e));
        return;
      }

      begin(t("stepUploading", { size: sizeLabel(file.size) ?? `${file.size} B` }));
      let storedPathname: string;
      try {
        const { upload } = await import("@vercel/blob/client");
        const blob = await upload(pathname, file, {
          access: "private",
          handleUploadUrl: "/api/year-end/evidence",
          clientPayload: JSON.stringify({
            kpiId,
            label: file.name,
            filename: file.name,
            contentType,
            sizeBytes: file.size,
          }),
        });
        storedPathname = blob.pathname;
        done(t("stepUploaded"));
      } catch (e) {
        // The one leg that cannot be reached from the build container, so it
        // gets the most explicit reporting: `describe` names CSP when the
        // browser never got a response at all.
        failHere(describe(e));
        return;
      }

      // Nothing is in the record yet. This creates the row, and the server
      // reads the stored bytes back and sniffs them before it does.
      begin(t("stepVerifying"));
      try {
        await apiClient.post("/api/year-end/evidence", {
          kpiId,
          pathname: storedPathname,
          label: file.name,
          contentType,
          sizeBytes: file.size,
        });
      } catch (e) {
        failHere(describe(e));
        return;
      }
      done();

      begin(t("stepSaved"));
      done();
      success(t("fileAdded"));
      reload();
    } catch (e) {
      // Anything the steps above did not anticipate still has to be visible —
      // a thrown `crypto.randomUUID` on an insecure origin, a chunk that would
      // not load. The alternative is the silence this whole function exists to
      // end.
      if (log.length === 0) begin(t("stepUnexpected"));
      failHere(describe(e));
    } finally {
      setBusy(false);
      // Cleared so choosing the SAME file again re-fires `onChange`; without
      // this a retry after a failure does nothing, which looks like yet another
      // silent failure.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function remove(item: EvidenceItem) {
    setBusy(true);
    try {
      await apiClient.delete(`/api/year-end/evidence/${item.id}`);
      success(t("removed"));
      reload();
    } catch (e) {
      fail(e, t("removeFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>{t("title")}</Label>
        {items.length === 0 ? (
          // Required, and said where it is needed rather than only at the
          // bottom of the page when Sign refuses.
          <Badge variant="warning">{t("required")}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t("count", { count: items.length, max: MAX_EVIDENCE_PER_KPI })}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("emptyHelp")}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border border-border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => void open(item)}
                  className="flex items-center gap-2 text-left text-sm text-primary underline-offset-2 hover:underline"
                >
                  {item.kind === "FILE" ? (
                    <Paperclip className="h-4 w-4 shrink-0" />
                  ) : (
                    <Link2 className="h-4 w-4 shrink-0" />
                  )}
                  <span>{item.label}</span>
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {sizeLabel(item.sizeBytes) ?? t("link")}
                  </span>
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={t("remove", { label: item.label })}
                      onClick={() => void remove(item)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("addedOn", { datetime: formatDateTime(item.uploadedAt) })}
              </p>
              {/* §7.1 — the manager's note on this item, shown to everyone who
                  can see the item itself. */}
              {item.managerComment ? (
                <p className="mt-1 rounded-md bg-muted/40 p-2 text-xs text-foreground">
                  {t("managerNote", { comment: item.managerComment })}
                </p>
              ) : null}
              {canComment ? <EvidenceCommentBox item={item} onSaved={reload} /> : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                void attachFile(f);
              } else {
                // Said out loud rather than returning quietly: a picker
                // dismissed with nothing chosen, or a file the OS would not
                // hand over, is otherwise indistinguishable from a broken
                // upload.
                setSteps([{ label: t("stepChoosing"), state: "failed", detail: t("stepNoFile") }]);
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || full || !storageConfigured}
            onClick={() => fileInput.current?.click()}
          >
            {t("addFile")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || full}
            onClick={() => setShowLink((v) => !v)}
          >
            {t("addLink")}
          </Button>
          {/* Said plainly rather than leaving a disabled button to be guessed
              at: the store is created by a person in a dashboard, so "not yet"
              is an ordinary state. */}
          {!storageConfigured ? (
            <span className="text-xs text-muted-foreground">{t("filesUnavailable")}</span>
          ) : null}
          {full ? <span className="text-xs text-muted-foreground">{t("atLimit")}</span> : null}
        </div>
      ) : null}

      {canEdit ? <StepList steps={steps} /> : null}

      {canEdit && showLink ? (
        <div className="mt-3 space-y-2">
          <input
            className="w-full rounded-md border border-border bg-background p-2 text-sm"
            placeholder={t("linkLabelPlaceholder")}
            value={linkLabel}
            onChange={(e) => setLinkLabel(e.target.value)}
          />
          <input
            className="w-full rounded-md border border-border bg-background p-2 text-sm"
            placeholder={t("linkUrlPlaceholder")}
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || linkLabel.trim() === "" || linkUrl.trim() === ""}
            onClick={() => void attachLink()}
          >
            {t("saveLink")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The manager's note on one item. Separate so the list stays readable. */
function EvidenceCommentBox({ item, onSaved }: { item: EvidenceItem; onSaved: () => void }) {
  const t = useTranslations("pms.evidence");
  const { success, error: showError } = useNotify();
  const [value, setValue] = useState(item.managerComment ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        className="min-w-0 flex-1 rounded-md border border-border bg-background p-2 text-xs"
        placeholder={t("commentPlaceholder")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={busy || value.trim() === "" || value.trim() === (item.managerComment ?? "")}
        onClick={async () => {
          setBusy(true);
          try {
            await apiClient.patch(`/api/year-end/evidence/${item.id}`, { comment: value.trim() });
            success(t("commentSaved"));
            onSaved();
          } catch (e) {
            showError(e instanceof ApiError ? e.message : t("commentFailed"));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("saveComment")}
      </Button>
    </div>
  );
}

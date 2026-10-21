"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

const ACCEPT = Object.keys(ALLOWED_EVIDENCE_TYPES).join(",");

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

function sizeLabel(bytes: number | null): string | null {
  if (bytes === null) return null;
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function KpiEvidence({
  kpiId,
  participantId,
  items,
  canEdit,
  canComment,
  storageConfigured,
}: {
  kpiId: string;
  /**
   * The owning participant. Needed because the server pins an upload to
   * `year-end/<participantId>/<kpiId>/` and the browser proposes the pathname
   * in Vercel's protocol — the client has to be able to name the one location
   * it is allowed to write to.
   */
  participantId: string;
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
  const { success, error: showError } = useNotify();
  const fileInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [showLink, setShowLink] = useState(false);

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
      router.refresh();
    } catch (e) {
      fail(e, t("addFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function attachFile(file: File) {
    setBusy(true);
    // Which half failed, so a refusal is diagnosable rather than "it didn't
    // work". The upload round trip cannot be exercised from the container this
    // was written in, so the error has to carry its own location.
    let stage: "upload" | "confirm" = "upload";
    try {
      // Client upload: the bytes go from here straight to private Blob
      // storage, because a Vercel function caps its body at ~4.5 MB and the
      // limit is 10 MB. The token minted server-side is what enforces the type
      // and size — this check is only so the refusal is instant and local.
      if (file.size > MAX_EVIDENCE_BYTES) {
        showError(t("tooLarge", { limit: MAX_EVIDENCE_BYTES / 1024 / 1024 }));
        return;
      }

      // THE PATH MATTERS. The server pins uploads to
      // `year-end/<participantId>/<kpiId>/`, so a token is only ever issued for
      // the KPI it authorised. This used to send `year-end/pending/<name>`,
      // which that pin can never accept — every file upload was refused.
      //
      // The basename is a UUID rather than the file's own name: a name with a
      // space, a slash or an Arabic character would fail the server's pathname
      // check, and in an RTL product that is the common case, not the edge. The
      // real name travels in `label` and is what every screen displays.
      const contentType = declaredType(file);
      if (contentType === null) {
        showError(
          t("typeNotAccepted", { types: Object.values(ALLOWED_EVIDENCE_TYPES).flat().join(", ") }),
        );
        return;
      }

      const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "bin";
      const pathname = `year-end/${participantId}/${kpiId}/${crypto.randomUUID()}.${ext}`;

      const { upload } = await import("@vercel/blob/client");
      const blob = await upload(pathname, file, {
        // PRIVATE, matching the store and the token. The earlier draft said
        // "public" with a comment claiming the server overrode it — the server
        // sets what the TOKEN grants, not what this call declares, so a
        // mismatch here would only have surfaced against a real store.
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

      // The bytes exist; nothing in the record does yet. This call is what
      // creates the row, and the server re-checks every rule and reads the
      // first bytes back before it does. Vercel's own `onUploadCompleted`
      // callback cannot do this job here: it arrives with no session and this
      // app answers 401 to that, so the row was never written.
      stage = "confirm";
      await apiClient.post("/api/year-end/evidence", {
        kpiId,
        pathname: blob.pathname,
        label: file.name,
        contentType,
        sizeBytes: file.size,
      });
      success(t("fileAdded"));
      router.refresh();
    } catch (e) {
      // A refusal from our own confirm route is a written sentence; a failure
      // in the upload leg is usually a CSP or token problem, where naming the
      // leg is the whole diagnosis.
      if (stage === "confirm") {
        fail(e, t("addFailed"));
      } else {
        showError(`${t("uploadFailed")} ${e instanceof Error ? e.message : ""}`.trim());
      }
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function remove(item: EvidenceItem) {
    setBusy(true);
    try {
      await apiClient.delete(`/api/year-end/evidence/${item.id}`);
      success(t("removed"));
      router.refresh();
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
              {canComment ? (
                <EvidenceCommentBox item={item} onSaved={() => router.refresh()} />
              ) : null}
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
              if (f) void attachFile(f);
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

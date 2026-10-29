"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError, apiClient } from "@/lib/api-client";
import {
  DOCUMENT_ANSWERS,
  MAX_PHOTO_BYTES,
  PHOTO_TYPES,
  PREBOARDING_DOCUMENTS,
  type DocumentAnswer,
  type PreboardingDocument,
} from "@/lib/jml/preboarding/rules";

/**
 * P2-4 — the joiner's preboarding form: an introduction, hobbies, a picture and
 * a documents checklist. Plain, one column, no account. The picture is optional
 * and honestly disabled when file storage is not set up.
 */

type View = {
  firstName: string;
  companyName: string | null;
  hrOwnerName: string | null;
  plannedStartDate: string | null;
  introSentence: string | null;
  hobbies: string | null;
  documents: Partial<Record<PreboardingDocument, DocumentAnswer>>;
  submittedAt: string | null;
  photoUploaded: boolean;
  storageConfigured: boolean;
};

const TEXTAREA =
  "min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PreboardingForm({ token, view }: { token: string; view: View }) {
  const t = useTranslations("jml.preboarding.public");
  const [intro, setIntro] = useState(view.introSentence ?? "");
  const [hobbies, setHobbies] = useState(view.hobbies ?? "");
  const [documents, setDocuments] = useState(view.documents);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    view.submittedAt ? "saved" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<"none" | "uploading" | "done" | "error">(
    view.photoUploaded ? "done" : "none",
  );
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setError(null);
    try {
      await apiClient.post(`/api/preboarding/${token}`, {
        introSentence: intro,
        hobbies,
        documents,
      });
      setState("saved");
    } catch (err) {
      setState("error");
      setError(err instanceof ApiError ? err.message : t("saveFailed"));
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
      setPhoto("error");
      setPhotoError(t("photoType"));
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhoto("error");
      setPhotoError(t("photoSize"));
      return;
    }
    setPhoto("uploading");
    const form = new FormData();
    form.set("file", file);
    try {
      const res = await fetch(`/api/preboarding/${token}/photo`, { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? t("photoFailed"));
      }
      setPhoto("done");
    } catch (err) {
      setPhoto("error");
      setPhotoError(err instanceof Error ? err.message : t("photoFailed"));
    }
  }

  return (
    <main className="mx-auto w-full max-w-[640px] space-y-8 px-4 py-10">
      <header className="space-y-2">
        <h1 className="m-0 text-h3 font-bold text-foreground">
          {t("heading", { name: view.firstName })}
        </h1>
        <p className="m-0 text-muted-foreground">
          {view.plannedStartDate
            ? t("introWithDate", {
                company: view.companyName ?? t("us"),
                date: view.plannedStartDate,
              })
            : t("intro", { company: view.companyName ?? t("us") })}
        </p>
        {view.hrOwnerName && (
          <p className="m-0 text-sm text-muted-foreground">
            {t("hrContact", { name: view.hrOwnerName })}
          </p>
        )}
      </header>

      <form onSubmit={submit} className="space-y-8">
        <section className="space-y-4">
          <h2 className="m-0 text-base font-semibold">{t("aboutYou")}</h2>
          <div className="space-y-1.5">
            <Label htmlFor="pb-intro">{t("introLabel")}</Label>
            <textarea
              id="pb-intro"
              className={TEXTAREA}
              maxLength={500}
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("introHelp")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pb-hobbies">{t("hobbiesLabel")}</Label>
            <textarea
              id="pb-hobbies"
              className={TEXTAREA}
              maxLength={500}
              value={hobbies}
              onChange={(e) => setHobbies(e.target.value)}
            />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="m-0 text-base font-semibold">{t("photoTitle")}</h2>
          {view.storageConfigured ? (
            <div className="space-y-1.5">
              <Label htmlFor="pb-photo">{t("photoLabel")}</Label>
              <input
                id="pb-photo"
                type="file"
                accept={PHOTO_TYPES.join(",")}
                disabled={photo === "uploading"}
                onChange={(e) => void upload(e.target.files?.[0])}
                className="block text-sm"
              />
              <p role="status" className="text-xs text-muted-foreground">
                {photo === "uploading"
                  ? t("photoUploading")
                  : photo === "done"
                    ? t("photoDone")
                    : t("photoHelp")}
              </p>
              {photoError && <p className="text-xs text-destructive">{photoError}</p>}
            </div>
          ) : (
            // Honest disabled state: uploads need file storage, which is not set up.
            <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              {t("photoUnavailable")}
            </p>
          )}
        </section>

        <fieldset className="space-y-4">
          <legend className="text-base font-semibold">{t("documentsTitle")}</legend>
          <p className="text-sm text-muted-foreground">{t("documentsHelp")}</p>
          {PREBOARDING_DOCUMENTS.map((doc) => (
            <div key={doc} className="space-y-2 rounded-md border border-border p-3">
              <p className="m-0 text-sm font-medium" id={`pb-doc-${doc}`}>
                {t(`document.${doc}`)}
              </p>
              <div
                role="radiogroup"
                aria-labelledby={`pb-doc-${doc}`}
                className="flex flex-wrap gap-4"
              >
                {DOCUMENT_ANSWERS.map((answer) => (
                  <label key={answer} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`doc-${doc}`}
                      value={answer}
                      checked={documents[doc] === answer}
                      onChange={() => setDocuments((d) => ({ ...d, [doc]: answer }))}
                    />
                    {t(`answer.${answer}`)}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={state === "saving"}>
            {state === "saving" ? t("saving") : view.submittedAt ? t("update") : t("submit")}
          </Button>
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {state === "saved" ? t("saved") : null}
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">{t("privacy")}</p>
      </form>
    </main>
  );
}

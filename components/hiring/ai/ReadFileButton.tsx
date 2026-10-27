"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { hiringUpload } from "../ui/api";
import { useAiStatus } from "./useAi";

type Mode = "cv" | "jd" | "competencies";
export type ParseResult<T> = { data: T | null; extractionFailed: boolean; manual: boolean };

/**
 * "Read from a file": sends a PDF or Word file to the parser and hands the
 * structured result back to the form for HR to review. Nothing is stored.
 * Disabled (with the reason as its title) when AI is not set up.
 */
export function ReadFileButton<T>({
  mode,
  label,
  onResult,
  onFile,
}: {
  mode: Mode;
  label: string;
  onResult: (data: T) => void;
  onFile?: (file: File) => void;
}) {
  const t = useTranslations("hiring.ai");
  const { ready } = useAiStatus();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function read(file: File) {
    setBusy(true);
    try {
      onFile?.(file);
      const form = new FormData();
      form.append("mode", mode);
      form.append("file", file);
      const r = await hiringUpload<ParseResult<T>>("/api/hiring/ai/parse", form);
      if (r.data) {
        onResult(r.data);
        toast.success(t("filled"));
      } else {
        toast.warning(r.extractionFailed ? t("unreadable") : t("manual"));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void read(f);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!ready || busy}
        title={ready ? undefined : t("notConfigured")}
        onClick={() => input.current?.click()}
      >
        <FileUp className="h-4 w-4" />
        {busy ? t("reading") : label}
      </Button>
    </>
  );
}

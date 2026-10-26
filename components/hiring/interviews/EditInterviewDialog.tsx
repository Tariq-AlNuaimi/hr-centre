"use client";

import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useHiringMutation } from "../ui/api";
import { InterviewForm, toLocalInput } from "./InterviewForm";
import { toInterviewBody } from "./NewInterview";
import type { InterviewDetailData as Detail } from "./types";

/** Edit an interview in place (Interview Hub's edit drawer). */
export function EditDialog({
  d,
  open,
  onOpenChange,
}: {
  d: Detail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("hiring.interview");
  const save = useHiringMutation<object>("PUT", `/api/hiring/interviews/${d.id}`, {
    success: t("updated"),
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("editTitle")}</DialogTitle>
        </DialogHeader>
        {open ? (
          <InterviewForm
            lockCandidate
            initial={{
              candidate: { id: d.candidate.id, name: d.candidate.name, requisition: d.requisition },
              round: d.round,
              when: toLocalInput(d.scheduledDate),
              status: d.status,
              panel: d.panelists.map((p) => ({ id: p.userId, name: p.name, email: p.email ?? "" })),
              location: d.location ?? "",
              meetingLink: d.meetingLink ?? "",
              notes: d.notes ?? "",
            }}
            submitting={save.isPending}
            submitLabel={t("save")}
            onSubmit={(v) => save.mutate(toInterviewBody(v))}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

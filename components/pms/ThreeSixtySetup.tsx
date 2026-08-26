"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SectionCard } from "@/components/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api-client";

/**
 * §9.1 and §9.2 — HR creating the 360 cycle and authoring its three question
 * templates.
 *
 * ## Why this exists
 *
 * `POST /api/three-sixty` had no caller. The 360 console could read a cycle,
 * regenerate assignments and activate — but nothing in the product could CREATE
 * the cycle, and there was no question-authoring surface anywhere. §9 is the
 * largest single piece of the specification and its first step was missing
 * (`docs/verification/SPEC-REDTEAM.md`, F3).
 *
 * It also made the §9.7 answering form unreachable in a real deployment: a form
 * can only be answered once a cycle and its templates exist, and until now only
 * the demo seeder could produce them.
 *
 * ## Both kinds of question, because §9.5 counts them differently
 *
 * §9.2 asks for "scored questions plus open-ended feedback questions", and the
 * difference is not cosmetic: §9.5 divides the answered scores by the form's
 * MAXIMUM, so an open-ended question must be excluded from that maximum rather
 * than counted as a zero. The editor makes the kind explicit per row and says
 * what it changes, rather than hiding it behind a flag nobody reads.
 *
 * ## The starter set is a starting point, not a recommendation
 *
 * The specification does not dictate question wording — that is Rihal's to
 * write. Fifteen empty boxes is a poor way to ask for it, so a starter set can
 * be loaded and then edited or deleted freely. It is labelled as exactly that.
 */

const TYPES = ["LINE_MANAGER_TO_EMPLOYEE", "EMPLOYEE_TO_LINE_MANAGER", "PEER_TO_PEER"] as const;
type AssessmentType = (typeof TYPES)[number];

type QuestionDraft = { text: string; scored: boolean };
type Drafts = Record<AssessmentType, QuestionDraft[]>;

/** §9.2's three directions, in the order the clause lists them. */
const STARTER: Drafts = {
  LINE_MANAGER_TO_EMPLOYEE: [
    { text: "Delivers what they commit to, on the agreed timeline", scored: true },
    { text: "Raises risks early rather than at the deadline", scored: true },
    { text: "Works well with people outside their own team", scored: true },
    { text: "Takes ownership of quality in their own work", scored: true },
    { text: "Anything else you would like to say about working with them?", scored: false },
  ],
  EMPLOYEE_TO_LINE_MANAGER: [
    { text: "Gives me the context I need to do my work", scored: true },
    { text: "Is available when I am blocked", scored: true },
    { text: "Gives feedback I can act on", scored: true },
    { text: "Represents my work fairly to others", scored: true },
    { text: "Anything else you would like to say about working with them?", scored: false },
  ],
  PEER_TO_PEER: [
    { text: "Is dependable when we work together", scored: true },
    { text: "Communicates clearly and early", scored: true },
    { text: "Shares knowledge rather than holding it", scored: true },
    { text: "Handles disagreement constructively", scored: true },
    { text: "Anything else you would like to say about working with them?", scored: false },
  ],
};

const EMPTY: Drafts = {
  LINE_MANAGER_TO_EMPLOYEE: [{ text: "", scored: true }],
  EMPLOYEE_TO_LINE_MANAGER: [{ text: "", scored: true }],
  PEER_TO_PEER: [{ text: "", scored: true }],
};

/**
 * Every template needs at least one SCORED question with real text.
 *
 * §9.2 asks for scored plus open-ended, and §9.5 computes the ratio as the
 * answered scores over the form's maximum — so a template of nothing but
 * open-ended questions yields no ratio at all, and every rater on it silently
 * contributes nothing to the ratee's 360. The route does NOT enforce this
 * (`createThreeSixtyCycleSchema` asks only for at least one question of any
 * kind), so unusually this screen is the only thing standing in the way. That
 * asymmetry is recorded in the evidence rather than left for someone to find.
 */
function readyToCreate(drafts: Drafts, opensAt: string, deadline: string): boolean {
  if (!opensAt || !deadline) return false;
  if (new Date(deadline) <= new Date(opensAt)) return false;
  return TYPES.every((type) => drafts[type].some((q) => q.scored && q.text.trim().length > 0));
}

export function ThreeSixtySetup({ cycleId }: { cycleId: string }) {
  const t = useTranslations("pms.threeSixtySetup");
  const tType = useTranslations("pms.threeSixty.templateType");
  const queryClient = useQueryClient();

  const [drafts, setDrafts] = useState<Drafts>(EMPTY);
  const [opensAt, setOpensAt] = useState("");
  const [deadline, setDeadline] = useState("");

  const edit = (type: AssessmentType, index: number, patch: Partial<QuestionDraft>) =>
    setDrafts((d) => ({
      ...d,
      [type]: d[type].map((q, i) => (i === index ? { ...q, ...patch } : q)),
    }));

  const addQuestion = (type: AssessmentType) =>
    setDrafts((d) => ({ ...d, [type]: [...d[type], { text: "", scored: true }] }));

  const removeQuestion = (type: AssessmentType, index: number) =>
    setDrafts((d) => ({ ...d, [type]: d[type].filter((_, i) => i !== index) }));

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post("/api/three-sixty", {
        cycleId,
        opensAt: new Date(opensAt).toISOString(),
        deadline: new Date(deadline).toISOString(),
        // Blank rows are dropped rather than sent — an empty question is
        // someone changing their mind, not something to reject them for.
        templates: TYPES.map((type) => ({
          type,
          questions: drafts[type]
            .filter((q) => q.text.trim().length > 0)
            .map((q) => ({ text: q.text.trim(), scored: q.scored })),
        })),
      }),
    onSuccess: () => {
      toast.success(t("createdToast"));
      void queryClient.invalidateQueries({ queryKey: ["pms", "360", cycleId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const ready = readyToCreate(drafts, opensAt, deadline);

  return (
    <div className="space-y-6">
      <SectionCard
        title={t("title")}
        subtitle={t("help")}
        actions={
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !ready}>
            {mutation.isPending ? t("working") : t("createAction")}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="three-sixty-opens">{t("opensAt")}</Label>
              <Input
                id="three-sixty-opens"
                type="date"
                value={opensAt}
                onChange={(e) => setOpensAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="three-sixty-deadline">{t("deadline")}</Label>
              <Input
                id="three-sixty-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
              {/* The route refuses this too; saying it here means the operator
                  learns it while typing rather than on submit. */}
              {opensAt && deadline && new Date(deadline) <= new Date(opensAt) && (
                <p className="text-xs text-destructive-emphasis">{t("deadlineAfterOpens")}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setDrafts(STARTER)}>
              {t("loadStarter")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDrafts(EMPTY)}>
              {t("clearAll")}
            </Button>
            <span className="text-xs text-muted-foreground">{t("starterHelp")}</span>
          </div>
        </div>
      </SectionCard>

      {TYPES.map((type) => {
        const questions = drafts[type];
        const scored = questions.filter((q) => q.scored && q.text.trim()).length;
        return (
          <SectionCard
            key={type}
            title={tType(type)}
            subtitle={t("scoredCount", { count: scored })}
            actions={
              <Button variant="outline" size="sm" onClick={() => addQuestion(type)}>
                {t("addQuestion")}
              </Button>
            }
          >
            <ol className="space-y-3">
              {questions.map((question, index) => (
                <li key={index} className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[16rem] flex-1 space-y-1">
                    <Label htmlFor={`q-${type}-${index}`}>
                      {t("questionLabel", { n: index + 1 })}
                    </Label>
                    <Input
                      id={`q-${type}-${index}`}
                      value={question.text}
                      placeholder={t("questionPlaceholder")}
                      onChange={(e) => edit(type, index, { text: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`kind-${type}-${index}`}>{t("kind")}</Label>
                    {/* A native select: two options, and the shared Select is a
                        Radix popover built for longer lists. */}
                    <select
                      id={`kind-${type}-${index}`}
                      value={question.scored ? "scored" : "open"}
                      onChange={(e) => edit(type, index, { scored: e.target.value === "scored" })}
                      className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                    >
                      <option value="scored">{t("kindScored")}</option>
                      <option value="open">{t("kindOpen")}</option>
                    </select>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeQuestion(type, index)}
                    disabled={questions.length === 1}
                  >
                    {t("removeQuestion")}
                  </Button>
                </li>
              ))}
            </ol>
            {scored === 0 && (
              // §9.5 divides by the scored maximum, so a template of nothing but
              // open-ended questions produces no ratio at all.
              <p className="mt-3 text-sm text-destructive-emphasis">{t("needsScored")}</p>
            )}
          </SectionCard>
        );
      })}

      <SectionCard title={t("whatNextTitle")}>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{t("stepOne")}</Badge>
          <span>→</span>
          <Badge variant="outline">{t("stepTwo")}</Badge>
          <span>→</span>
          <Badge variant="outline">{t("stepThree")}</Badge>
        </div>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">{t("whatNextHelp")}</p>
      </SectionCard>
    </div>
  );
}

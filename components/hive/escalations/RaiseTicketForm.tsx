"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { useNotify } from "@/hooks/use-notify";
import { apiClient } from "@/lib/api-client";
import { ESCALATION_QUESTION_MAX } from "@/lib/validations/hive/escalation";

interface Person {
  id: string;
  name: string;
  email: string;
  company: string;
}

/**
 * HR raises a ticket for an employee (source HR). The ticket routes to the
 * employee's HR pair like any other and is answered through the normal draft →
 * approval flow; the answer goes to the employee's work email.
 */
export function RaiseTicketForm({ initialEmployeeId }: { initialEmployeeId: string | null }) {
  const t = useTranslations("hive.raise");
  const locale = useLocale();
  const router = useRouter();
  const notify = useNotify();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Person | null>(null);
  const [cleared, setCleared] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  // Prefill from the employee record's "Raise HR ticket" action.
  const initial = useQuery({
    queryKey: ["hive", "raise", "employee", initialEmployeeId],
    queryFn: () =>
      apiClient.get<Person[]>(`/api/hive/employees?id=${encodeURIComponent(initialEmployeeId!)}`),
    enabled: initialEmployeeId !== null,
  });
  const people = useQuery({
    queryKey: ["hive", "raise", "search", search],
    queryFn: () =>
      apiClient.get<Person[]>(`/api/hive/employees?search=${encodeURIComponent(search.trim())}`),
    enabled: search.trim().length >= 2,
  });
  const person = picked ?? (cleared ? null : (initial.data?.[0] ?? null));
  const trimmed = question.trim();
  const canSubmit = person !== null && trimmed.length >= 5 && !busy;

  async function submit() {
    if (!person) return;
    setBusy(true);
    try {
      const ticket = await apiClient.post<{ id: string }>("/api/hive/escalations", {
        employeeId: person.id,
        question: trimmed,
      });
      notify.success(t("raised"));
      router.push(`/${locale}/tickets/${ticket.id}`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : t("failed"));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("intro")} />
      <SectionCard title={t("employeeTitle")}>
        {person ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm text-foreground">
              {person.name}{" "}
              <span className="text-muted-foreground">
                · {person.email} · {person.company}
              </span>
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPicked(null);
                setCleared(true);
              }}
            >
              {t("change")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="raise-search">{t("searchLabel")}</Label>
            <Input
              id="raise-search"
              value={search}
              placeholder={t("searchPlaceholder")}
              autoComplete="off"
              onChange={(e) => setSearch(e.target.value)}
            />
            {search.trim().length < 2 ? (
              <p className="m-0 text-sm text-muted-foreground">{t("searchHint")}</p>
            ) : people.isLoading ? (
              <p className="m-0 text-sm text-muted-foreground">{t("searching")}</p>
            ) : people.isError ? (
              <p role="alert" className="m-0 text-sm text-destructive-emphasis">
                {t("searchFailed")}
              </p>
            ) : (people.data ?? []).length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">{t("noMatches")}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {(people.data ?? []).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1.5 text-start text-sm hover:bg-muted"
                      onClick={() => setPicked(p)}
                    >
                      {p.name}{" "}
                      <span className="text-muted-foreground">
                        · {p.email} · {p.company}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </SectionCard>
      <SectionCard title={t("questionTitle")} subtitle={t("questionHint")}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="raise-question">{t("questionLabel")}</Label>
          <textarea
            id="raise-question"
            rows={6}
            className="min-h-32 w-full rounded-md border border-input bg-background p-3 text-sm"
            maxLength={ESCALATION_QUESTION_MAX}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </div>
      </SectionCard>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void submit()} disabled={!canSubmit}>
          {busy ? t("raising") : t("raise")}
        </Button>
        <Button variant="outline" onClick={() => router.push(`/${locale}/tickets`)}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}

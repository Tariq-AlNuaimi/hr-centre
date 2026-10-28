"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";

type Person = { id: string; name: string | null; email: string };
type Desk = "IT" | "FINANCE";
type Settings = { desks: Record<Desk, Person[]>; candidates: Person[] };

const DESKS: Desk[] = ["IT", "FINANCE"];
const label = (p: Person) => (p.name ? `${p.name} (${p.email})` : p.email);

/** Task routing (docs/blueprints/jml-task-routing.md US-1): the named people on each desk. */
export function TaskRoutingSettings() {
  const t = useTranslations("jml.settings.taskRouting");
  const { can, isLoading } = useJmlAccess();
  const allowed = can("jml.configure");
  const q = useQuery({
    queryKey: ["jml", "task-routing"],
    queryFn: () => apiClient.get<Settings>("/api/jml/config/task-routing"),
    enabled: allowed,
  });
  // Unsaved edits; until the first one, the saved lists are shown.
  const [edited, setDraft] = useState<Record<Desk, Person[]> | null>(null);
  const draft = edited ?? q.data?.desks ?? null;
  const { run, busy } = useJmlAction(t("failed"));
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  const frame = (body: ReactNode) => (
    <div className="space-y-6">
      {header}
      {body}
    </div>
  );
  if (isLoading || (allowed && q.isLoading)) return frame(<LoadingBlock />);
  if (!allowed) return frame(<NotPermitted title={t("title")} />);
  if (q.isError || !q.data || !draft) return frame(<LoadFailed />);
  const candidates = q.data.candidates;
  const save = () =>
    void run(
      () =>
        apiClient.put("/api/jml/config/task-routing", {
          IT: draft.IT.map((p) => p.id),
          FINANCE: draft.FINANCE.map((p) => p.id),
        }),
      t("saved"),
    ).then((ok) => ok && setDraft(null));
  return frame(
    <>
      {DESKS.map((desk) => (
        <DeskCard
          key={desk}
          desk={desk}
          people={draft[desk]}
          candidates={candidates}
          onChange={(people) => setDraft({ ...draft, [desk]: people })}
        />
      ))}
      <div>
        <Button onClick={save} disabled={busy}>
          {t("save")}
        </Button>
      </div>
    </>,
  );
}

function DeskCard({
  desk,
  people,
  candidates,
  onChange,
}: {
  desk: Desk;
  people: Person[];
  candidates: Person[];
  onChange: (people: Person[]) => void;
}) {
  const t = useTranslations("jml.settings.taskRouting");
  const listed = new Set(people.map((p) => p.id));
  const pickable = candidates.filter((c) => !listed.has(c.id));
  const selectId = `desk-${desk}-add`;
  return (
    <SectionCard
      title={`${t(`desk.${desk}`)} · ${t("count", { count: people.length })}`}
      subtitle={t(`deskNote.${desk}`)}
    >
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="mb-3 flex flex-wrap gap-2">
          {people.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm"
            >
              {label(p)}
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("remove", { name: p.name ?? p.email })}
                onClick={() => onChange(people.filter((x) => x.id !== p.id))}
              >
                <X className="h-3 w-3" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor={selectId} className="mt-3 block text-sm font-medium text-foreground">
        {t("add")}
      </label>
      <NativeSelect
        id={selectId}
        value=""
        className="mt-1 w-full sm:w-96"
        onChange={(e) => {
          const p = candidates.find((c) => c.id === e.target.value);
          if (p) onChange([...people, p]);
        }}
      >
        <option value="">{t("addPlaceholder")}</option>
        {pickable.map((c) => (
          <option key={c.id} value={c.id}>
            {label(c)}
          </option>
        ))}
      </NativeSelect>
    </SectionCard>
  );
}

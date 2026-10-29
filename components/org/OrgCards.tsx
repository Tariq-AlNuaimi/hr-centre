"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  personContext,
  type OrgCardPerson,
  type OrgChartDepartment,
  type OrgChartEntity,
} from "@/lib/pms/org-chart";

/**
 * P2 (UX R19) — the visual card mode of the org chart: per company, one card
 * per unit with its head, people count and (for HR/executives) open roles from
 * requisitions; and "centre on person", which puts someone between their
 * manager and their direct reports. Reads only the already-scoped set the page
 * passes in (§4.2).
 */
export function OrgCards({
  entities,
  people,
  openRoles,
  initialPersonId = null,
}: {
  entities: OrgChartEntity[];
  people: OrgCardPerson[];
  /** Open roles per department id; null when the reader may not see requisitions. */
  openRoles: Record<string, number> | null;
  initialPersonId?: string | null;
}) {
  const t = useTranslations("org.cards");
  const [centre, setCentre] = useState<string | null>(initialPersonId);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [people, query]);
  const context = centre ? personContext(people, centre) : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Label htmlFor="org-centre">{t("centreOn")}</Label>
        <Input
          id="org-centre"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("centrePlaceholder")}
          autoComplete="off"
        />
        {matches.length > 0 && (
          <ul className="flex flex-wrap gap-2 pt-1">
            {matches.map((p) => (
              <li key={p.id}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCentre(p.id);
                    setQuery("");
                  }}
                >
                  {p.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {context ? (
        <section aria-label={t("centredOn", { name: context.person.name })} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="m-0 text-sm font-semibold">
              {t("centredOn", { name: context.person.name })}
            </h3>
            <Button size="sm" variant="link" className="h-auto p-0" onClick={() => setCentre(null)}>
              {t("backToUnits")}
            </Button>
          </div>
          <div className="flex flex-col items-center gap-3">
            {context.manager ? (
              <PersonCard person={context.manager} label={t("manager")} onPick={setCentre} />
            ) : (
              <p className="m-0 text-xs text-muted-foreground">{t("noManager")}</p>
            )}
            <PersonCard person={context.person} highlight />
            {context.reports.length > 0 ? (
              <ul className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {context.reports.map((r) => (
                  <li key={r.id}>
                    <PersonCard person={r} onPick={setCentre} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-xs text-muted-foreground">{t("noReports")}</p>
            )}
          </div>
        </section>
      ) : (
        entities.map((entity) => (
          <section key={entity.id} className="space-y-3">
            <h3 className="m-0 text-sm font-semibold">
              {entity.code}
              <span className="ms-2 text-xs font-normal text-muted-foreground">
                {t("people", { count: entity.headcount })}
                {entity.headName ? ` · ${t("head", { name: entity.headName })}` : ""}
              </span>
            </h3>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {entity.departments.map((d) => (
                <li key={d.id ?? `${entity.id}-top`}>
                  <UnitCard
                    unit={d}
                    open={d.id && openRoles ? (openRoles[d.id] ?? 0) : null}
                    onPick={setCentre}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function UnitCard({
  unit,
  open,
  onPick,
}: {
  unit: OrgChartDepartment;
  open: number | null;
  onPick: (id: string) => void;
}) {
  const t = useTranslations("org.cards");
  return (
    <div className="h-full space-y-2 rounded-md border border-border bg-card p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="m-0 font-medium">{unit.name ?? t("leadership")}</p>
        {open !== null && open > 0 ? (
          <Badge variant="outline">{t("openRoles", { count: open })}</Badge>
        ) : null}
      </div>
      <p className="m-0 text-xs text-muted-foreground">
        {unit.headName ? t("head", { name: unit.headName }) : t("noHead")} ·{" "}
        {t("people", { count: unit.headcount })}
      </p>
      {unit.tops.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {unit.tops.slice(0, 4).map((p) => (
            <li key={p.id}>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onPick(p.id)}>
                {p.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PersonCard({
  person,
  label,
  highlight = false,
  onPick,
}: {
  person: OrgCardPerson;
  label?: string;
  highlight?: boolean;
  onPick?: (id: string) => void;
}) {
  const body = (
    <>
      {label && <span className="block text-xs text-muted-foreground">{label}</span>}
      <span className="block font-medium">{person.name}</span>
      {person.departmentName && (
        <span className="block text-xs text-muted-foreground">{person.departmentName}</span>
      )}
    </>
  );
  const cls = `w-full min-w-48 rounded-md border p-3 text-start text-sm ${
    highlight ? "border-primary bg-primary/5" : "border-border bg-card"
  }`;
  return onPick ? (
    <button type="button" className={`${cls} hover:bg-muted/50`} onClick={() => onPick(person.id)}>
      {body}
    </button>
  ) : (
    <div className={cls} aria-current="true">
      {body}
    </div>
  );
}

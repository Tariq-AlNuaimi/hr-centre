"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { Field } from "../Field";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";

type Schedule = {
  workingDays: number[];
  startHour: number;
  endHour: number;
  timeZone: string;
  isDefault: boolean;
};
type Holiday = { id: string; date: string; name: string };

const WEEKDAYS = [7, 1, 2, 3, 4, 5, 6];

/** The ONE working calendar (ADR-077): weekly schedule + public holidays. */
export function CalendarSettings() {
  const t = useTranslations("jml.settings.calendar");
  const { can, isLoading } = useJmlAccess();
  const allowed = can("jml.configure");
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const schedule = useQuery({
    queryKey: ["jml", "schedule"],
    queryFn: () => apiClient.get<Schedule>("/api/jml/config/schedule"),
    enabled: allowed,
  });
  const holidays = useQuery({
    queryKey: ["jml", "holidays", year],
    queryFn: () => apiClient.get<Holiday[]>(`/api/jml/config/holidays?year=${year}`),
    enabled: allowed,
  });
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  if (isLoading || (allowed && schedule.isLoading))
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  if (!allowed)
    return (
      <div className="space-y-6">
        {header}
        <NotPermitted title={t("title")} />
      </div>
    );
  if (schedule.isError || !schedule.data)
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed />
      </div>
    );
  return (
    <div className="space-y-6">
      {header}
      <ScheduleForm key={JSON.stringify(schedule.data)} initial={schedule.data} />
      <SectionCard title={t("holidays")} subtitle={t("holidaysNote")}>
        <div className="mb-4 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setYear(year - 1)}>
            {t("previousYear")}
          </Button>
          <span className="text-sm font-medium text-foreground">{year}</span>
          <Button variant="outline" size="sm" onClick={() => setYear(year + 1)}>
            {t("nextYear")}
          </Button>
        </div>
        {holidays.isLoading ? (
          <LoadingBlock />
        ) : holidays.isError ? (
          <LoadFailed />
        ) : (holidays.data ?? []).length === 0 ? (
          <EmptyState description={t("noHolidays", { year })} />
        ) : (
          <HolidayList holidays={holidays.data ?? []} />
        )}
        <AddHoliday />
      </SectionCard>
    </div>
  );
}

function ScheduleForm({ initial }: { initial: Schedule }) {
  const t = useTranslations("jml.settings.calendar");
  const { run, busy } = useJmlAction(t("saveFailed"));
  const [days, setDays] = useState<number[]>(initial.workingDays);
  const [startHour, setStartHour] = useState(String(initial.startHour));
  const [endHour, setEndHour] = useState(String(initial.endHour));
  const [timeZone, setTimeZone] = useState(initial.timeZone);
  const toggle = (d: number) =>
    setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);
  return (
    <SectionCard
      title={t("schedule")}
      subtitle={initial.isDefault ? t("isDefault") : t("futureOnly")}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              apiClient.put("/api/jml/config/schedule", {
                workingDays: days,
                startHour: Number(startHour),
                endHour: Number(endHour),
                timeZone,
              }),
            t("saved"),
          );
        }}
      >
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-foreground">{t("workingDays")}</legend>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={days.includes(d)} onChange={() => toggle(d)} />
                {t(`day.${d}`)}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("weekend", {
              days:
                WEEKDAYS.filter((d) => !days.includes(d))
                  .map((d) => t(`day.${d}`))
                  .join(", ") || t("none"),
            })}
          </p>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="cal-start" label={t("startHour")}>
            <Input
              id="cal-start"
              type="number"
              min={0}
              max={23}
              value={startHour}
              onChange={(e) => setStartHour(e.target.value)}
            />
          </Field>
          <Field id="cal-end" label={t("endHour")}>
            <Input
              id="cal-end"
              type="number"
              min={1}
              max={24}
              value={endHour}
              onChange={(e) => setEndHour(e.target.value)}
            />
          </Field>
          <Field id="cal-tz" label={t("timeZone")}>
            <Input id="cal-tz" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" disabled={busy}>
          {t("save")}
        </Button>
      </form>
    </SectionCard>
  );
}

function HolidayList({ holidays }: { holidays: Holiday[] }) {
  const t = useTranslations("jml.settings.calendar");
  const { run, busy } = useJmlAction(t("saveFailed"));
  return (
    <ul className="mb-4 divide-y divide-border">
      {holidays.map((h) => (
        <li key={h.id} className="flex items-center justify-between py-2 text-sm">
          <span className="text-foreground">
            {h.date.slice(0, 10)} — {h.name}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(() => apiClient.delete(`/api/jml/config/holidays/${h.id}`), t("removed"))
            }
          >
            {t("remove")}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function AddHoliday() {
  const t = useTranslations("jml.settings.calendar");
  const { run, busy } = useJmlAction(t("saveFailed"));
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-3 border-t border-border pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const done = await run(
          () => apiClient.post("/api/jml/config/holidays", { date, name }),
          t("added"),
        );
        if (done) {
          setDate("");
          setName("");
        }
      }}
    >
      <Field id="hol-date" label={t("date")}>
        <Input
          id="hol-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </Field>
      <Field id="hol-name" label={t("name")}>
        <Input id="hol-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Button type="submit" disabled={busy || !date || !name.trim()}>
        {t("add")}
      </Button>
    </form>
  );
}

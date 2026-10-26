"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dayKey, timeOf } from "./time";
import type { InterviewRow } from "./types";

const MAX_PER_DAY = 3;

/** A month grid of interviews (Interview Hub `InterviewsListCalendar`), Sunday-first like the Omani week. */
export function MonthCalendar({ rows }: { rows: InterviewRow[] }) {
  const t = useTranslations("hiring.interviews");
  const locale = useLocale();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  });
  const byDay = new Map<string, InterviewRow[]>();
  for (const r of rows)
    byDay.set(dayKey(r.scheduledDate), [...(byDay.get(dayKey(r.scheduledDate)) ?? []), r]);
  const first = month.getUTCDay();
  const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, i) => {
    const d = i - first + 1;
    return d >= 1 && d <= days
      ? new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), d))
      : null;
  });
  const today = dayKey(new Date());
  const title = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(month);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, 10, 1 + i)),
    ),
  );
  const shift = (n: number) =>
    setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + n, 1)));
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-3 flex items-center justify-between">
        <Button variant="ghost" size="icon" aria-label={t("prevMonth")} onClick={() => shift(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button variant="ghost" size="icon" aria-label={t("nextMonth")} onClick={() => shift(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div
        role="grid"
        aria-label={title}
        className="grid grid-cols-7 gap-px overflow-hidden rounded-md bg-border"
      >
        {weekdays.map((w) => (
          <div
            key={w}
            role="columnheader"
            className="bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground"
          >
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          const key = d ? d.toISOString().slice(0, 10) : `x${i}`;
          const items = d ? (byDay.get(key) ?? []) : [];
          return (
            <div
              key={key}
              role="gridcell"
              className={cn("min-h-24 bg-card p-1.5", !d && "bg-muted/40")}
            >
              {d ? (
                <>
                  <span
                    className={cn(
                      "text-xs",
                      key === today ? "font-bold text-primary-emphasis" : "text-muted-foreground",
                    )}
                  >
                    {d.getUTCDate()}
                  </span>
                  <ul className="mt-1 space-y-0.5">
                    {items.slice(0, MAX_PER_DAY).map((r) => (
                      <li key={r.id} className="truncate text-xs">
                        <Link
                          href={`/${locale}/hiring/interviews/${r.id}`}
                          className="hover:underline"
                        >
                          <span className="font-mono font-semibold tabular-nums">
                            {timeOf(r.scheduledDate)}
                          </span>{" "}
                          {r.candidate.name}
                        </Link>
                      </li>
                    ))}
                    {items.length > MAX_PER_DAY ? (
                      <li className="text-xs text-muted-foreground">
                        {t("more", { count: items.length - MAX_PER_DAY })}
                      </li>
                    ) : null}
                  </ul>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-center text-sm text-muted-foreground">{t("noneScheduled")}</p>
      ) : null}
    </div>
  );
}

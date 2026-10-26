"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarPlus, ChevronRight, MapPin, Phone, Trash2, Video } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { initials, RsvpBadge, useRoundLabel } from "./bits";
import { dayKey, dayName, relativeDay, timeRange } from "./time";
import type { InterviewRow } from "./types";

function LocationIcon({ location }: { location: string | null }) {
  const v = (location ?? "").toLowerCase();
  if (/teams|zoom|meet|video|online|virtual|http/.test(v))
    return <Video aria-hidden className="h-4 w-4" />;
  if (/phone|call|tel/.test(v)) return <Phone aria-hidden className="h-4 w-4" />;
  return <MapPin aria-hidden className="h-4 w-4" />;
}

/**
 * Interviews grouped by day (Interview Hub `InterviewsListSchedule`): time
 * range from the round's length, candidate, panel and RSVP state, calendar
 * invite, and — for HR — delete.
 */
export function ScheduleList({
  rows,
  hideRequisition,
  onDelete,
  rowExtra,
  empty,
}: {
  rows: InterviewRow[];
  hideRequisition?: boolean;
  onDelete?: (id: string) => void;
  rowExtra?: (r: InterviewRow) => ReactNode;
  empty: ReactNode;
}) {
  const t = useTranslations("hiring.interviews");
  const locale = useLocale();
  const roundLabel = useRoundLabel();
  if (rows.length === 0) return <>{empty}</>;
  const groups = new Map<string, InterviewRow[]>();
  for (const r of [...rows].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))) {
    const key = dayKey(r.scheduledDate);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([key, items]) => {
        const rel = relativeDay(key);
        const name = dayName(items[0].scheduledDate);
        return (
          <section key={key} aria-label={name}>
            <h3 className="mb-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
              {rel === null
                ? name
                : t(`relDay.${rel === 0 ? "today" : rel === 1 ? "tomorrow" : "yesterday"}`, {
                    day: name,
                  })}
            </h3>
            <ul className="space-y-2">
              {items.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-card px-4 py-3"
                >
                  <span className="min-w-28 font-mono text-sm font-bold tabular-nums">
                    {timeRange(r.scheduledDate, r.roundMinutes)}
                  </span>
                  <Avatar className="h-9 w-9" aria-hidden>
                    <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                      {initials(r.candidate.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-40 flex-1">
                    <Link
                      href={`/${locale}/hiring/interviews/${r.id}`}
                      className="font-semibold text-foreground hover:underline"
                    >
                      {r.candidate.name}
                    </Link>
                    {hideRequisition ? null : (
                      <p className="text-xs text-muted-foreground">{r.requisition.title}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {r.panelists.length
                        ? r.panelists.map((p) => p.name).join(", ")
                        : t("noPanel")}
                    </p>
                  </div>
                  <Badge variant="outline">{roundLabel(r.round, r.roundOrdinal)}</Badge>
                  <span className="flex min-w-24 items-center gap-1.5 text-xs text-muted-foreground">
                    <LocationIcon location={r.location} />
                    {r.location ?? "—"}
                  </span>
                  <RsvpBadge status={r.status} panel={r.panelists} />
                  <div className="flex items-center gap-1">
                    <a
                      href={`/api/hiring/interviews/${r.id}/ics`}
                      aria-label={t("downloadIcs")}
                      title={t("downloadIcs")}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <CalendarPlus aria-hidden className="h-4 w-4" />
                    </a>
                    {onDelete ? (
                      <ConfirmAction
                        title={t("deleteConfirm")}
                        okText={t("delete")}
                        okType="danger"
                        onConfirm={() => onDelete(r.id)}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={t("deleteNamed", { name: r.candidate.name })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </ConfirmAction>
                    ) : null}
                    {rowExtra?.(r)}
                    <ChevronRight aria-hidden className="h-4 w-4 text-muted-foreground" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

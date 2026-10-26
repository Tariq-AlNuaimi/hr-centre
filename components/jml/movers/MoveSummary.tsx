"use client";

import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CaseDetail } from "../case/types";

/** What a MOVE changes (Onboarding ChangeHistory): field, previous, new — and whether it is applied. */
export function MoveSummary({ move }: { move: NonNullable<CaseDetail["moveDetail"]> }) {
  const t = useTranslations("jml.movers");
  const tc = useTranslations("people.record.contract");
  const show = (field: string, s?: { value: string | null; label: string | null }) => {
    if (!s?.value) return t("none");
    return field === "employmentType" ? tc(s.value) : (s.label ?? s.value);
  };
  return (
    <SectionCard
      title={t("summaryTitle", { type: t(`changeType.${move.changeType}`) })}
      subtitle={
        move.appliedAt
          ? t("applied", { date: move.appliedAt.slice(0, 10), note: move.applyNote ?? "" })
          : t("notApplied", { date: move.effectiveDate.slice(0, 10) })
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("col.field")}</TableHead>
            <TableHead>{t("col.previous")}</TableHead>
            <TableHead>{t("col.new")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.keys(move.newDetails).map((f) => (
            <TableRow key={f}>
              <TableCell className="text-sm font-medium">{t(`field.${f}`)}</TableCell>
              <TableCell className="text-sm">{show(f, move.previousDetails[f])}</TableCell>
              <TableCell className="text-sm">{show(f, move.newDetails[f])}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SectionCard>
  );
}

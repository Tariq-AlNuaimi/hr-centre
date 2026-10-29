"use client";

import { useTranslations } from "next-intl";
import type { NineBoxCell } from "@/lib/pms/distribution";

/**
 * P2-1 — the optional 9-box: calibrated performance (rows) × 360 feedback
 * (columns). A reading aid for the calibration conversation, never an input:
 * nothing here moves a band (§10.4). People without a 360 level are counted
 * below the grid rather than placed in a column.
 */
export function NineBox({
  cells,
  withoutFeedback,
}: {
  cells: NineBoxCell[];
  withoutFeedback: number;
}) {
  const t = useTranslations("pms.nineBox");
  const rows = ["HIGH", "MID", "LOW"] as const;
  const cols = ["LOW", "MID", "HIGH"] as const;
  const cellOf = (p: string, f: string) =>
    cells.find((c) => c.performance === p && c.feedback === f);

  return (
    <div className="space-y-3">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{t("caption")}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="w-28 p-2 text-start text-xs font-medium text-muted-foreground"
            >
              {t("performanceAxis")}
            </th>
            {cols.map((f) => (
              <th
                key={f}
                scope="col"
                className="p-2 text-start text-xs font-medium text-muted-foreground"
              >
                {t(`feedback.${f}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p}>
              <th scope="row" className="p-2 text-start text-xs font-medium text-muted-foreground">
                {t(`performance.${p}`)}
              </th>
              {cols.map((f) => {
                const cell = cellOf(p, f);
                const people = cell?.people ?? [];
                return (
                  <td key={f} className="border border-border p-2 align-top">
                    <div className="text-lg font-semibold">{cell?.count ?? 0}</div>
                    {people.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                        {people.slice(0, 6).map((person) => (
                          <li key={person.employeeId} className="truncate">
                            {person.name}
                          </li>
                        ))}
                        {people.length > 6 && <li>{t("more", { count: people.length - 6 })}</li>}
                      </ul>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        {t("footnote")}
        {withoutFeedback > 0 && ` ${t("withoutFeedback", { count: withoutFeedback })}`}
      </p>
    </div>
  );
}

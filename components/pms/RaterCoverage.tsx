"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { UseMutationResult } from "@tanstack/react-query";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { DataTable } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RaterEditor } from "@/components/pms/RaterEditor";

/**
 * §9.4's coverage table and §9.6's per-ratee editing.
 *
 * Extracted from the 360 console page for the reason that page's own header
 * already gives: it orchestrates four server calls AND renders five states, and
 * adding §9.6's edit dialog pushed it past the complexity budget. The seam is
 * the honest one — this owns "who assesses whom, and is it enough"; the page
 * owns which cycle is being looked at.
 */

/** §9.4 — "Raters — exactly 3 per employee". */
const RATERS_PER_EMPLOYEE = 3;

type CoverageRow = { rateeId: string; name: string; raterCount: number };
type AssignmentRow = {
  ratee: { id: string; name: string };
  rater?: { id: string; name: string };
};

export function RaterCoverage({
  threeSixtyId,
  status,
  coverage,
  short,
  assignments,
  generate,
  activate,
}: {
  threeSixtyId: string;
  status: string;
  coverage: CoverageRow[];
  short: CoverageRow[];
  assignments: AssignmentRow[];
  generate: UseMutationResult<unknown, Error, void, unknown>;
  activate: UseMutationResult<unknown, Error, void, unknown>;
}) {
  const t = useTranslations("pms.threeSixty");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  return (
    <>
      <SectionCard
        title={t("assignments")}
        subtitle={t("assignmentsHelp")}
        actions={
          status === "DRAFT" ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={generate.isPending}
                onClick={() => generate.mutate()}
              >
                {generate.isPending ? t("generating") : t("generateAction")}
              </Button>
              <Button
                size="sm"
                // §9.4's "exactly 3" is checked at activation (§9.6 lets HR
                // hold a half-built set on screen), so the button says why
                // rather than failing on press.
                disabled={short.length > 0 || coverage.length === 0 || activate.isPending}
                onClick={() => activate.mutate()}
              >
                {activate.isPending ? t("activating") : t("activateAction")}
              </Button>
            </div>
          ) : null
        }
        noBodyPadding
      >
        {short.length > 0 && (
          <p className="px-6 pt-4 text-sm text-destructive-emphasis">
            {t("shortfallHelp", { count: short.length })}
          </p>
        )}
        {coverage.length === 0 ? (
          <div className="p-6">
            <EmptyState description={t("noAssignments")} />
          </div>
        ) : (
          <DataTable<{ rateeId: string; name: string; raterCount: number }>
            rowKey="rateeId"
            dataSource={coverage}
            total={coverage.length}
            page={1}
            pageSize={coverage.length}
            columns={[
              { key: "name", title: t("employee"), dataIndex: "name" },
              {
                key: "raterCount",
                title: t("raterCount"),
                render: (
                  _v: unknown,
                  row: { rateeId: string; name: string; raterCount: number },
                ) => (
                  <Badge variant={row.raterCount === RATERS_PER_EMPLOYEE ? "success" : "warning"}>
                    {row.raterCount} / {RATERS_PER_EMPLOYEE}
                  </Badge>
                ),
              },
              {
                key: "edit",
                title: t("editRaters"),
                // §9.6's "HR reviews and EDITS" — only before launch, which
                // is the same window the route enforces.
                render: (
                  _v: unknown,
                  row: { rateeId: string; name: string; raterCount: number },
                ) =>
                  status === "DRAFT" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing({ id: row.rateeId, name: row.name })}
                    >
                      {t("editRatersAction")}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </SectionCard>

      <RaterEditor
        threeSixtyCycleId={threeSixtyId}
        ratee={editing}
        currentRaters={assignments
          .filter((a) => a.ratee.id === editing?.id && a.rater)
          .map((a) => a.rater!)}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

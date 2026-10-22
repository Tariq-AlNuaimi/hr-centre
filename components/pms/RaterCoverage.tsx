"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { UseMutationResult } from "@tanstack/react-query";
import { SectionCard } from "@/components/shared/SectionCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ThreeSixtyRaterEditor,
  type EditableAssignment,
} from "@/components/pms/ThreeSixtyRaterEditor";
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
  /** Needed to address ONE assignment, which is how a live cycle is edited. */
  id: string;
  /** §9.7's derived status — SUBMITTED is what locks a row. */
  status: string;
  ratee: { id: string; name: string };
  rater?: { id: string; name: string };
  template: { type: string };
};

export function RaterCoverage({
  threeSixtyId,
  status,
  coverage,
  short,
  assignments,
  canManage,
  generate,
  activate,
}: {
  threeSixtyId: string;
  status: string;
  coverage: CoverageRow[];
  short: CoverageRow[];
  assignments: AssignmentRow[];
  /**
   * §4.1 — regenerate, activate and per-ratee editing are HR's. `orgWide` also
   * covers the executive viewers, who may write nothing, so gating on it
   * offered them three buttons that always 403.
   */
  canManage: boolean;
  generate: UseMutationResult<unknown, Error, void, unknown>;
  activate: UseMutationResult<unknown, Error, void, unknown>;
}) {
  const t = useTranslations("pms.threeSixty");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  /** The LIVE-cycle editor: per assignment, not the whole set. */
  const [liveEditing, setLiveEditing] = useState<{ id: string; name: string } | null>(null);

  return (
    <>
      <SectionCard
        title={t("assignments")}
        subtitle={t("assignmentsHelp")}
        actions={
          status === "DRAFT" && canManage ? (
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
          // The CONSEQUENCE depends on where the cycle is. On a draft, being
          // short of three blocks §9.7's launch. On a live cycle it cannot —
          // the launch already happened — and saying "the cycle cannot be
          // activated" there is simply false: what it actually means is that
          // §9.5 will average those employees over fewer assessments. The copy
          // used to say the draft sentence in both places, which nobody saw
          // until this screen started being used after launch.
          <p
            className={
              status === "DRAFT"
                ? "px-6 pt-4 text-sm text-destructive-emphasis"
                : "px-6 pt-4 text-sm text-warning-emphasis"
            }
          >
            {status === "DRAFT"
              ? t("shortfallHelp", { count: short.length })
              : t("shortfallHelpLive", { count: short.length })}
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
                // §9.6's "HR reviews and EDITS" before launch, and §9.4's
                // "HR selects and MANAGES all rater assignments" after it.
                // They are different editors because they are different acts:
                // on a draft the whole set is replaced wholesale, which is
                // right for building it and catastrophic on a live cycle where
                // raters are part-way through forms. After launch, each
                // assignment is changed on its own.
                render: (
                  _v: unknown,
                  row: { rateeId: string; name: string; raterCount: number },
                ) => {
                  if (!canManage) return null;
                  if (status === "DRAFT") {
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing({ id: row.rateeId, name: row.name })}
                      >
                        {t("editRatersAction")}
                      </Button>
                    );
                  }
                  if (status === "ACTIVE") {
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLiveEditing({ id: row.rateeId, name: row.name })}
                      >
                        {t("manageRatersAction")}
                      </Button>
                    );
                  }
                  return null;
                },
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

      {/* §9.4 after launch. Separate dialog from `RaterEditor` above because
          the act is different: one assignment at a time, with a submitted one
          locked rather than silently replaced. */}
      <Dialog open={liveEditing !== null} onOpenChange={(open) => !open && setLiveEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("manageRatersTitle", { name: liveEditing?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("manageRatersHelp")}</DialogDescription>
          </DialogHeader>
          {liveEditing && (
            <ThreeSixtyRaterEditor
              rateeId={liveEditing.id}
              rateeName={liveEditing.name}
              assignments={assignments
                .filter((a) => a.ratee.id === liveEditing.id && a.rater)
                .map((a) => ({
                  id: a.id,
                  status: a.status as EditableAssignment["status"],
                  rater: a.rater!,
                  template: a.template,
                }))}
              otherRaterIds={assignments
                .filter((a) => a.ratee.id === liveEditing.id && a.rater)
                .map((a) => a.rater!.id)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

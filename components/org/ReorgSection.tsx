"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api-client";
import { NativeSelect } from "./NativeSelect";
import { useOrgAction } from "./useOrgAction";
import type { Department, Directorate, Team } from "./types";

/**
 * P2 (UX R19) — effective-dated reorganisation: schedule a rename or a move of
 * a directorate, department or team "from" a date, see what is scheduled, and
 * the history of what was applied (or refused, with the reason).
 */

type Kind = "DIRECTORATE" | "DEPARTMENT" | "TEAM";
type Change = {
  id: string;
  unitKind: Kind;
  unitName: string | null;
  effectiveDate: string;
  newName: string | null;
  moveParent: boolean;
  newParentName: string | null;
  beforeName: string | null;
  beforeParentName: string | null;
  note: string | null;
  status: "SCHEDULED" | "APPLIED" | "FAILED" | "CANCELLED";
  failureReason: string | null;
};
type Listing = { scheduled: Change[]; history: Change[] };

const NO_DIRECTORATE = "__none__";

export function ReorgSection({
  directorates,
  departments,
  teams,
}: {
  directorates: Directorate[];
  departments: Department[];
  teams: Team[];
}) {
  const t = useTranslations("org.reorg");
  const q = useQuery({
    queryKey: ["org", "changes"],
    queryFn: () => apiClient.get<Listing>("/api/org/changes"),
  });
  const { run, busy } = useOrgAction(t("failed"));
  const [kind, setKind] = useState<Kind>("DEPARTMENT");
  const [unitId, setUnitId] = useState("");
  const [newName, setNewName] = useState("");
  const [parent, setParent] = useState("");
  const [date, setDate] = useState("");
  const [applyNow, setApplyNow] = useState(false);
  // QA2 N-05 — a past date applies at once, so it needs HR to say so.
  const today = new Date().toLocaleDateString("en-CA");
  const past = date !== "" && date < today;

  const units = kind === "DIRECTORATE" ? directorates : kind === "DEPARTMENT" ? departments : teams;
  const parents: { id: string; name: string }[] =
    kind === "DEPARTMENT" ? directorates : kind === "TEAM" ? departments : [];

  async function schedule() {
    const body: Record<string, unknown> = { unitKind: kind, unitId, effectiveDate: date };
    if (newName.trim()) body.newName = newName.trim();
    if (parent) body.newParentId = parent === NO_DIRECTORATE ? null : parent;
    if (past) body.applyNow = applyNow;
    const okd = await run(() => apiClient.post("/api/org/changes", body), t("scheduled"));
    if (okd) {
      setNewName("");
      setParent("");
      setDate("");
      setApplyNow(false);
    }
  }

  const describe = (c: Change) =>
    [
      c.newName ? t("renameTo", { name: c.newName }) : null,
      c.moveParent ? t("moveTo", { name: c.newParentName ?? t("noParent") }) : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <SectionCard title={t("title")} subtitle={t("subtitle")}>
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="reorg-kind">{t("kind")}</Label>
            <NativeSelect
              id="reorg-kind"
              className="w-full"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as Kind);
                setUnitId("");
                setParent("");
              }}
            >
              {(["DIRECTORATE", "DEPARTMENT", "TEAM"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`kindValue.${k}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="reorg-unit">{t("unit")}</Label>
            <NativeSelect
              id="reorg-unit"
              className="w-full"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
            >
              <option value="">{t("choose")}</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="reorg-name">{t("newName")}</Label>
            <Input id="reorg-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reorg-parent">{t("newParent")}</Label>
            <NativeSelect
              id="reorg-parent"
              className="w-full"
              value={parent}
              disabled={kind === "DIRECTORATE"}
              onChange={(e) => setParent(e.target.value)}
            >
              <option value="">{t("keepParent")}</option>
              {kind === "DEPARTMENT" && <option value={NO_DIRECTORATE}>{t("noParent")}</option>}
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="reorg-date">{t("from")}</Label>
            <Input
              id="reorg-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
        {past ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={applyNow}
              onChange={(e) => setApplyNow(e.target.checked)}
            />
            {t("applyNow")}
          </label>
        ) : null}
        <Button
          size="sm"
          disabled={busy || !unitId || !date || (!newName.trim() && !parent) || (past && !applyNow)}
          onClick={() => void schedule()}
        >
          {t("schedule")}
        </Button>

        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : q.isError || !q.data ? (
          <p role="alert" className="text-sm text-destructive-emphasis">
            {t("loadFailed")}
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <h4 className="m-0 text-sm font-semibold">{t("upcoming")}</h4>
              {q.data.scheduled.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noneScheduled")}</p>
              ) : (
                <ul className="space-y-2">
                  {q.data.scheduled.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
                    >
                      <span>
                        <span className="font-medium">{c.unitName ?? t("unknownUnit")}</span>{" "}
                        <span className="text-muted-foreground">
                          {describe(c)} · {t("fromDate", { date: c.effectiveDate.slice(0, 10) })}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => apiClient.delete(`/api/org/changes/${c.id}`),
                            t("cancelled"),
                          )
                        }
                      >
                        {t("cancel")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-2">
              <h4 className="m-0 text-sm font-semibold">{t("history")}</h4>
              {q.data.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
              ) : (
                <ul className="space-y-2">
                  {q.data.history.map((c) => (
                    <li key={c.id} className="rounded-md border border-border p-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {c.beforeName ?? c.unitName ?? t("unknownUnit")}
                        </span>
                        <Badge variant={c.status === "APPLIED" ? "success" : "outline"}>
                          {t(`status.${c.status}`)}
                        </Badge>
                      </div>
                      <p className="m-0 text-muted-foreground">
                        {describe(c)} · {t("fromDate", { date: c.effectiveDate.slice(0, 10) })}
                        {c.status === "APPLIED" && c.moveParent && c.beforeParentName
                          ? ` · ${t("wasUnder", { name: c.beforeParentName })}`
                          : ""}
                      </p>
                      {c.failureReason && (
                        <p className="m-0 text-xs text-destructive-emphasis">{c.failureReason}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}

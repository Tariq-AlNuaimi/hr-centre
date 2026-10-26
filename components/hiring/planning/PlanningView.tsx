"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/org/NativeSelect";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";
import { formatDate } from "@/lib/format";
import { useHiringMe, useHiringMutation, useHiringQuery } from "../ui/api";
import { StatusBadge } from "../ui/badges";
import { QueryState } from "../ui/states";
import { CanvassDialog, OpenCycleForm } from "./CycleDialogs";
import { NeedDialog } from "./NeedDialog";
import type { NeedRow, RoundView } from "./types";

/**
 * Step 1 — workforce planning (Interview Hub `WorkforcePlanningClient`,
 * artboard W01): canvass departments, chase non-responders, challenge each
 * requirement, then raise requisitions from what survived the challenge.
 */
type RoundSummary = { id: string; label: string; status: string; entity: { name: string } | null };

export function PlanningView() {
  const t = useTranslations("hiring.planning");
  const { has } = useHiringMe();
  const rounds = useHiringQuery<{ data: RoundSummary[] }>(
    "/api/hiring/planning-rounds?pageSize=100",
  );
  const [picked, setRoundId] = useState("");
  const roundId = picked || rounds.data?.data[0]?.id || "";
  const view = useHiringQuery<RoundView>(roundId ? `/api/hiring/planning-rounds/${roundId}` : null);
  const list = rounds.data?.data ?? [];
  return (
    <QueryState isLoading={rounds.isLoading} error={rounds.error}>
      <div className="space-y-4">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            list.length ? (
              <NativeSelect
                aria-label={t("cycle")}
                value={roundId}
                onChange={(e) => setRoundId(e.target.value)}
              >
                {list.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label} · {r.entity?.name ?? "—"} ·{" "}
                    {r.status === "OPEN" ? t("open") : t("closed")}
                  </option>
                ))}
              </NativeSelect>
            ) : null
          }
        />
        {list.length === 0 ? (
          <SectionCard title={t("noCycleTitle")}>
            {has("hiring.manage") ? (
              <OpenCycleForm onOpened={setRoundId} />
            ) : (
              <EmptyState description={t("noCycleViewer")} />
            )}
          </SectionCard>
        ) : (
          <QueryState isLoading={view.isLoading} error={view.error}>
            {view.data ? <Round v={view.data} onOpened={setRoundId} /> : null}
          </QueryState>
        )}
      </div>
    </QueryState>
  );
}

function Round({ v, onOpened }: { v: RoundView; onOpened: (id: string) => void }) {
  const t = useTranslations("hiring.planning");
  const [need, setNeed] = useState<NeedRow | null>(null);
  const [canvass, setCanvass] = useState(false);
  const [newCycle, setNewCycle] = useState(false);
  const path = `/api/hiring/planning-rounds/${v.id}`;
  const chase = useHiringMutation<undefined, { chased: number }>("POST", `${path}/chase`, {
    success: t("chased"),
  });
  const toggle = useHiringMutation<object>("PATCH", path, { success: t("cycleUpdated") });
  const s = v.stats;
  const open = v.status === "OPEN";
  return (
    <div className="space-y-4">
      {!open ? (
        <p className="rounded-md border border-border bg-muted px-4 py-2 text-sm text-muted-foreground">
          {t("closedBanner")}
        </p>
      ) : null}
      {v.canManage ? (
        <div className="flex flex-wrap gap-2">
          {open ? <Button onClick={() => setCanvass(true)}>{t("canvass")}</Button> : null}
          {open ? (
            <Button
              variant="outline"
              disabled={chase.isPending}
              onClick={() => chase.mutate(undefined)}
            >
              {t("chase")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => toggle.mutate({ status: open ? "CLOSED" : "OPEN" })}
          >
            {open ? t("closeCycle") : t("reopenCycle")}
          </Button>
          <Button variant="ghost" onClick={() => setNewCycle(true)}>
            {t("newCycle")}
          </Button>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("asked")}
          value={s.departmentsAsked}
          hint={t("openedOn", { date: formatDate(v.openedAt) })}
        />
        <StatCard
          title={t("responded")}
          value={s.responded}
          hint={t("outstanding", { n: s.outstanding })}
        />
        <StatCard
          title={t("rolesRequested")}
          value={s.rolesRequested}
          hint={t("beforeChallenge")}
        />
        <StatCard title={t("agreed")} value={s.agreedAfterChallenge} hint={t("afterChallenge")} />
      </div>
      <SectionCard title={t("standsTitle")}>
        <p className="text-sm text-foreground">
          {s.departmentsAsked === 0
            ? t("standsEmpty")
            : `${s.raisedDepartments.length ? t("standsRaised", { list: s.raisedDepartments.join(", ") }) : t("standsNoneRaised")} ${
                s.stillToDiscuss
                  ? t("standsToDiscuss", { n: s.stillToDiscuss })
                  : t("standsAllDiscussed")
              }`}
        </p>
      </SectionCard>
      <SectionCard title={t("departments")} noBodyPadding>
        {v.needs.length === 0 ? <EmptyState description={t("noDepartments")} /> : null}
        <ul className="divide-y divide-border">
          {v.needs.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => setNeed(n)}
                className="grid w-full gap-2 px-6 py-3 text-start text-sm hover:bg-muted md:grid-cols-5"
              >
                <span className="font-medium text-foreground">{n.department}</span>
                <span className="text-muted-foreground">
                  {t("rolesCell", {
                    requested: n.rolesRequested ?? "—",
                    agreed: n.agreedRoles ?? "—",
                  })}
                </span>
                <span className="text-muted-foreground">
                  {t(`contact.${n.lastContact.kind}`, {
                    date: n.lastContact.at ? formatDate(n.lastContact.at) : "",
                  })}
                </span>
                <span>
                  <StatusBadge kind="need" value={n.status} />
                </span>
                <span className="text-muted-foreground">
                  {n.raised.length ? n.raised.map((r) => r.title).join(", ") : "—"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </SectionCard>
      {need ? <NeedDialog need={need} round={v} onClose={() => setNeed(null)} /> : null}
      {canvass ? <CanvassDialog round={v} onClose={() => setCanvass(false)} /> : null}
      {newCycle ? (
        <SectionCard title={t("newCycle")}>
          <OpenCycleForm
            onOpened={(id) => {
              setNewCycle(false);
              onOpened(id);
            }}
          />
        </SectionCard>
      ) : null}
    </div>
  );
}

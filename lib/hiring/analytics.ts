import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { holdsAnywhere, type HiringActor } from "./access";
import { acceptanceRate, avgDays, FUNNEL_STAGES, pct, suppressSmallCells } from "./analytics-rules";
import { isOmani } from "./candidate-rules";
import { orgNames } from "./people";
import { requisitionScopeWhere } from "./scope";
import { readSetting } from "./settings";

/**
 * Hiring insights (Interview Hub `/insights` + `/api/executive/velocity`,
 * `/omanization`, `/dei`). D12 fixed: every figure is computed over the
 * records the reader may see (`hiring.view`), not the whole organisation.
 * Omanization needs `hiring.manage`; DEI needs `hiring.viewDei` and is
 * small-cell suppressed. Aggregates only — no names, no pay.
 */

const HIRE_SCAN_CAP = 10_000;
const TERMINAL = ["REJECTED", "WITHDRAWN", "HIRED"] as const;

type CandWhere = Prisma.HiringCandidateWhereInput;

async function scopes(
  actor: HiringActor,
  permission: "hiring.view" | "hiring.manage" | "hiring.viewDei",
) {
  const req = await requisitionScopeWhere(actor, permission);
  if (req === null) return null;
  const group = Object.keys(req).length === 0;
  const cand: CandWhere = group ? { erasedAt: null } : { erasedAt: null, requisition: { is: req } };
  return { req, cand };
}

async function kpis(req: Prisma.HiringRequisitionWhereInput, cand: CandWhere) {
  // Group scope ({}) reads everything; a relation filter on an empty object is avoided on purpose.
  const viaReq = Object.keys(req).length === 0 ? {} : { requisition: { is: req } };
  const offerWhere: Prisma.HiringOfferWhereInput = viaReq;
  const [open, active, interviews, offers, accepted, declined, hires] = await Promise.all([
    prisma.hiringRequisition.count({ where: { ...req, status: "OPEN" } }),
    prisma.hiringCandidate.count({ where: { ...cand, stage: { notIn: [...TERMINAL] } } }),
    prisma.hiringInterview.count({
      where: { ...viaReq, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
    }),
    prisma.hiringOffer.count({
      where: { ...offerWhere, status: { in: ["PENDING_APPROVAL", "APPROVED", "SENT"] } },
    }),
    prisma.hiringOffer.count({ where: { ...offerWhere, status: "ACCEPTED" } }),
    prisma.hiringOffer.count({ where: { ...offerWhere, status: "DECLINED" } }),
    prisma.hiringCandidate.count({ where: { ...cand, stage: "HIRED" } }),
  ]);
  return {
    openRequisitions: open,
    activeCandidates: active,
    upcomingInterviews: interviews,
    liveOffers: offers,
    hires,
    offerAcceptance: acceptanceRate(accepted, declined),
  };
}

async function funnel(cand: CandWhere) {
  const rows = await prisma.hiringCandidate.groupBy({
    by: ["stage"],
    where: cand,
    _count: { _all: true },
    orderBy: { stage: "asc" },
  });
  const byStage = new Map(rows.map((r) => [r.stage as string, r._count._all]));
  return {
    stages: FUNNEL_STAGES.map((stage) => ({ stage, count: byStage.get(stage) ?? 0 })),
    rejected: byStage.get("REJECTED") ?? 0,
    withdrawn: byStage.get("WITHDRAWN") ?? 0,
  };
}

/** Days from application to the move into HIRED (exact, from stage history), overall and per company. */
async function velocity(cand: CandWhere) {
  const rows = await prisma.hiringStageHistory.findMany({
    where: { toStage: "HIRED", candidate: { is: cand } },
    orderBy: { movedAt: "desc" },
    take: HIRE_SCAN_CAP,
    select: {
      movedAt: true,
      candidate: { select: { createdAt: true, requisition: { select: { entityId: true } } } },
    },
  });
  const per = new Map<string, number[]>();
  const all: number[] = [];
  for (const r of rows) {
    const span = r.movedAt.getTime() - r.candidate.createdAt.getTime();
    all.push(span);
    const e = r.candidate.requisition?.entityId;
    if (e) per.set(e, [...(per.get(e) ?? []), span]);
  }
  const names = await orgNames([...per.keys()], []);
  return {
    avgDaysToHire: avgDays(all),
    hires: all.length,
    truncated: rows.length >= HIRE_SCAN_CAP,
    byCompany: [...per.entries()]
      .map(([id, spans]) => ({
        company: names.entities.get(id)?.name ?? "—",
        avgDays: avgDays(spans),
        hires: spans.length,
      }))
      .sort((a, b) => a.company.localeCompare(b.company)),
  };
}

/** Omani hires as a share of hires, per company, against the Tawteen target. */
async function omanization(cand: CandWhere) {
  const [rows, raw] = await Promise.all([
    prisma.hiringCandidate.findMany({
      where: { ...cand, stage: "HIRED" },
      orderBy: { updatedAt: "desc" },
      take: HIRE_SCAN_CAP,
      select: { nationality: true, requisition: { select: { entityId: true } } },
    }),
    readSetting("tawteen.targets"),
  ]);
  const targets = ((raw as { targets?: Record<string, number> } | null)?.targets ?? {}) as Record<
    string,
    number
  >;
  const per = new Map<string, { hires: number; omani: number }>();
  for (const r of rows) {
    const e = r.requisition?.entityId;
    if (!e) continue;
    const acc = per.get(e) ?? { hires: 0, omani: 0 };
    acc.hires += 1;
    if (isOmani(r.nationality)) acc.omani += 1;
    per.set(e, acc);
  }
  const names = await orgNames([...per.keys()], []);
  const companies = [...per.entries()].map(([id, v]) => {
    const org = names.entities.get(id);
    const target = org ? (targets[org.code] ?? null) : null;
    const share = pct(v.omani, v.hires);
    return {
      company: org?.name ?? "—",
      hires: v.hires,
      omani: v.omani,
      pct: share,
      target,
      meetsTarget: target === null || share === null ? null : share >= target,
    };
  });
  const hires = rows.length;
  const omani = rows.filter((r) => isOmani(r.nationality)).length;
  return {
    overall: { hires, omani, pct: pct(omani, hires) },
    companies: companies.sort((a, b) => a.company.localeCompare(b.company)),
    truncated: rows.length >= HIRE_SCAN_CAP,
  };
}

/** Self-declared gender / ethnicity among candidates, buckets under five merged and withheld. */
async function dei(cand: CandWhere) {
  const [g, e] = await Promise.all([
    prisma.hiringCandidate.groupBy({
      by: ["deiGender"],
      where: { ...cand, deiGender: { not: null } },
      _count: { _all: true },
      orderBy: { deiGender: "asc" },
      take: 50,
    }),
    prisma.hiringCandidate.groupBy({
      by: ["deiEthnicity"],
      where: { ...cand, deiEthnicity: { not: null } },
      _count: { _all: true },
      orderBy: { deiEthnicity: "asc" },
      take: 200,
    }),
  ]);
  const gender = g.map((r) => ({ value: r.deiGender ?? "", count: r._count._all }));
  const ethnicity = e.map((r) => ({ value: r.deiEthnicity ?? "", count: r._count._all }));
  return {
    gender: suppressSmallCells(gender),
    ethnicity: suppressSmallCells(ethnicity),
    declaredGender: gender.reduce((s, r) => s + r.count, 0),
    declaredEthnicity: ethnicity.reduce((s, r) => s + r.count, 0),
  };
}

export async function insightsView(actor: HiringActor) {
  const view = await scopes(actor, "hiring.view");
  if (!view) return null;
  const [k, f, v] = await Promise.all([
    kpis(view.req, view.cand),
    funnel(view.cand),
    velocity(view.cand),
  ]);
  const manage = await scopes(actor, "hiring.manage");
  const deiScope = holdsAnywhere(actor, "hiring.viewDei")
    ? await scopes(actor, "hiring.viewDei")
    : null;
  return {
    kpis: { ...k, avgDaysToHire: v.avgDaysToHire },
    funnel: f,
    velocity: v,
    omanization: manage ? await omanization(manage.cand) : null,
    dei: deiScope ? await dei(deiScope.cand) : null,
    scoped: Object.keys(view.req).length > 0,
  };
}

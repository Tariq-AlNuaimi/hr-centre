"use client";

import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDateTime } from "@/lib/format";
import { useHiringQuery } from "../ui/api";
import { StatusBadge } from "../ui/badges";

type NeedView = {
  department: string | null;
  roundLabel: string;
  status: string;
  rolesRequested: number | null;
  agreedRoles: number | null;
  notes: {
    id: string;
    authorName: string;
    authorRole: string | null;
    body: string;
    createdAt: string;
  }[];
};

/** The requirement challenge carried onto a request raised from the plan. */
export function NeedContext({ needId }: { needId: string }) {
  const t = useTranslations("hiring.planning");
  const { data } = useHiringQuery<NeedView>(`/api/hiring/needs/${needId}`);
  if (!data) return null;
  return (
    <SectionCard
      title={t("challengeTitle", { department: data.department ?? "—" })}
      subtitle={t("challengeHint", { cycle: data.roundLabel })}
      actions={<StatusBadge kind="need" value={data.status} />}
    >
      <p className="text-sm text-foreground">
        {t("challengeCounts", {
          requested: data.rolesRequested ?? 0,
          agreed: data.agreedRoles ?? 0,
        })}
      </p>
      <ul className="mt-3 space-y-2">
        {data.notes.map((n) => (
          <li key={n.id} className="rounded-md border border-border p-3 text-sm">
            <p className="text-xs text-muted-foreground">
              {n.authorName}
              {n.authorRole ? ` · ${n.authorRole}` : ""} · {formatDateTime(n.createdAt)}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-foreground">{n.body}</p>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

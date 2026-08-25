"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDateTime } from "@/lib/format";

/**
 * §5.1's two signatures — the employee's and the manager's.
 *
 * Split out of `KpiDraftBoard` when that component crossed the complexity
 * budget; the seam is real rather than arbitrary, because signing answers a
 * different question from drafting and §5.1 keeps them apart deliberately
 * (agreement, then HR's approval as the lock).
 *
 * Two spec points live here and nowhere else:
 *
 *  - **There is no reject button.** §5.3: "If the employee does not agree, they
 *    simply do not sign. There is no 'reject' button — the unsigned state is the
 *    signal." So an unsigned party is STATED, not represented by a missing row,
 *    and a standing note says the conversation happens offline. Adding a reject
 *    control here would invent process the spec deliberately omits.
 *  - **§5.3's exactly-100% rule gates signing, not drafting.** The gate is the
 *    server's `weightageComplete` boolean, never a client-side re-sum of the
 *    decimal string — a float re-sum of three 33.33s disagrees with the server
 *    about whether the set is signable.
 */

export type SignOffParty = "EMPLOYEE" | "MANAGER";

export interface SignOffRow {
  party: SignOffParty;
  signedAt: string | null;
  canSign: boolean;
}

export function SignOffPanel({
  parties,
  weightageComplete,
  stageLocked,
  signingParty,
  blocked,
  onSign,
}: {
  parties: SignOffRow[];
  weightageComplete: boolean;
  stageLocked: boolean;
  signingParty: SignOffParty | null;
  blocked: boolean;
  onSign: (party: SignOffParty) => void;
}) {
  const t = useTranslations("pms.kpi");

  return (
    <SectionCard title={t("signOffTitle")} subtitle={t("signOffBody")}>
      <div className="space-y-4">
        {parties.map(({ party, signedAt, canSign }) => (
          <div
            key={party}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 last:border-b-0 last:pb-0"
          >
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-foreground">{t(`party.${party}`)}</p>
              {/* The unsigned state is the signal (§5.3) — so it is stated,
                  not left as a missing row. */}
              <p className="text-xs text-muted-foreground">
                {signedAt ? t("signedAt", { datetime: formatDateTime(signedAt) }) : t("notSigned")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {signedAt ? <Badge variant="success">{t("signedBadge")}</Badge> : null}
              {!signedAt && canSign ? (
                <Button
                  variant="secondary"
                  disabled={!weightageComplete || stageLocked || signingParty !== null || blocked}
                  onClick={() => onSign(party)}
                >
                  {signingParty === party
                    ? t("signing")
                    : party === "EMPLOYEE"
                      ? t("signAsEmployee")
                      : t("signAsManager")}
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">{t("noRejectNote")}</p>
      </div>
    </SectionCard>
  );
}

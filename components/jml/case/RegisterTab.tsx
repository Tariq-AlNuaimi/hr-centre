"use client";

import { AccessSection } from "./AccessSection";
import { AssetsSection } from "./AssetsSection";
import { LIVE, type CaseDetail } from "./types";

/** Assets and access (D3: one register, issued at JOIN, returned at LEAVE). */
export function RegisterTab({ detail }: { detail: CaseDetail }) {
  const active = LIVE.has(detail.status);
  return (
    <div className="space-y-6">
      <AssetsSection caseId={detail.id} active={active} leave={detail.caseType === "LEAVE"} />
      <AccessSection caseId={detail.id} active={active} />
    </div>
  );
}

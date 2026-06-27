import { CircleCheck, CircleDashed, CircleMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CompetencyBand } from "@/lib/scoring-rollup";

// Competency band as a calm 3-tone signal (UI-SPEC A.2) — NEVER traffic-light, and
// NEVER color-only: each band pairs its signal tint with a distinct icon + text
// label so it reads for color-blind users and screen readers (axe).
const BAND: Record<
  CompetencyBand,
  { variant: "pass" | "partial" | "below"; Icon: typeof CircleCheck }
> = {
  PASS: { variant: "pass", Icon: CircleCheck },
  PARTIAL: { variant: "partial", Icon: CircleDashed },
  BELOW: { variant: "below", Icon: CircleMinus },
};

export function BandPill({ band, label }: { band: CompetencyBand; label: string }) {
  const { variant, Icon } = BAND[band];
  return (
    <Badge variant={variant} className="gap-1">
      <Icon aria-hidden className="size-3" />
      {label}
    </Badge>
  );
}

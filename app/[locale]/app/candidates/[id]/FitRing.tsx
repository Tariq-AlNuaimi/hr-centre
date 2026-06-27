// Fit-to-role ring (UI-SPEC D.7 §1). Pure SVG (no JS, server-rendered): a
// band-colored arc whose sweep encodes the 0–100 fit score, with the number in the
// center. Color follows the calm 3-tone signal scale by fit threshold (never
// traffic-light). The number is the accessible value; the ring is decorative.
function fitColor(fit: number): string {
  if (fit >= 70) return "var(--signal-pass)";
  if (fit >= 50) return "var(--signal-partial)";
  return "var(--signal-below)";
}

export function FitRing({ fit, label }: { fit: number; label: string }) {
  const size = 132;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, fit)) / 100) * circumference;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      role="img"
      aria-label={`${label}: ${fit} / 100`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--secondary)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={fitColor(fit)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="absolute flex flex-col items-center">
        <span className="font-display text-3xl font-semibold tabular-nums text-foreground">
          {fit}
        </span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </span>
    </div>
  );
}

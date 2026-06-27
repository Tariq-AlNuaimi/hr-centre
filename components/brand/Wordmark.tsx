import { cn } from "@/lib/utils";

/**
 * The Rihal mark: a thin "journey" line that rises and lands on a sand dot —
 * the evidence-trail / rihal (journey) motif (UI-SPEC A.1). Used in the app
 * shell, the candidate runner header, and the auth screen.
 */
export function RihalMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className={cn("h-7 w-7", className)}
    >
      <rect width="28" height="28" rx="8" className="fill-[var(--rihal-deep)]" />
      <path
        d="M6 19.5C9 19.5 9.5 9.5 14 9.5C18.5 9.5 19 16.5 22 16.5"
        stroke="var(--rihal-azure)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="22" cy="16.5" r="2.2" fill="var(--rihal-sand)" />
    </svg>
  );
}

/** Full lockup: mark + wordmark. `subtle` mutes the secondary word. */
export function Wordmark({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <RihalMark />
      {showText && (
        <span className="font-display text-base font-semibold leading-none tracking-tight text-foreground">
          Rihal{" "}
          <span className="font-normal text-muted-foreground">Aptitude</span>
        </span>
      )}
    </span>
  );
}

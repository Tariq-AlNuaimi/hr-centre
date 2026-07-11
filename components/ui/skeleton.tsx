import { cn } from "@/lib/utils";

/**
 * Skeleton — shadcn/ui-style loading placeholder (ADR-029, Workstream C2). A
 * pulsing block on the semantic `bg-muted` token (dark-correct via the single
 * variable swap). The layout-matched Skeletons in components/shared/Skeletons
 * compose these into page/table/form silhouettes, replacing AntD `<Skeleton>`.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />
  );
}

import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Pipeline stat tile (UI-SPEC D.1). Tabular-nums keeps the figures aligned.
export function StatCard({
  label,
  value,
  icon: Icon,
  className,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {label}
          </span>
          <span className="font-display text-2xl font-semibold tabular-nums text-foreground">
            {value}
          </span>
        </div>
        {Icon && (
          <span className="rounded-md bg-secondary p-2 text-accent">
            <Icon className="size-4" />
          </span>
        )}
      </div>
    </Card>
  );
}

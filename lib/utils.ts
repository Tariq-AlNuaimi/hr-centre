import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * `cn` — the shadcn/ui class-name helper (ADR-029, Workstream C2). Combines
 * clsx (conditional/array class composition) with tailwind-merge (last-wins
 * conflict resolution so a caller override like `className="p-0"` beats a
 * component's default `p-4`). Every `components/ui/*` and rebuilt
 * `components/shared/*` primitive composes its classes through this.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

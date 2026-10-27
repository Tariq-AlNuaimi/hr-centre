"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A horizontally scrolling row that SAYS it scrolls (UX P1-8: the board's later
 * columns were clipped with no hint): a fade on each clipped edge and an arrow
 * button that pages the row. Works in either direction (RTL scrollLeft is ≤ 0).
 */
export function ScrollStrip({ children, className }: { children: ReactNode; className?: string }) {
  const t = useTranslations("hiring.pipeline");
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const pos = Math.abs(el.scrollLeft);
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: pos > 2, end: pos < max - 2 });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure]);
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl" ? -1 : 1;
    el.scrollBy({ left: dir * rtl * el.clientWidth * 0.8, behavior: "smooth" });
  };
  return (
    <div className="relative">
      <div ref={ref} className={cn("overflow-x-auto", className)}>
        {children}
      </div>
      {edges.start ? <Edge side="start" label={t("scrollStart")} onClick={() => page(-1)} /> : null}
      {edges.end ? <Edge side="end" label={t("scrollEnd")} onClick={() => page(1)} /> : null}
    </div>
  );
}

function Edge({
  side,
  label,
  onClick,
}: {
  side: "start" | "end";
  label: string;
  onClick: () => void;
}) {
  const Icon = side === "start" ? ChevronLeft : ChevronRight;
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-y-0 flex w-12 items-center",
        side === "start"
          ? "start-0 justify-start bg-linear-to-r from-background to-transparent rtl:bg-linear-to-l"
          : "end-0 justify-end bg-linear-to-l from-background to-transparent rtl:bg-linear-to-r",
      )}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="pointer-events-auto h-8 w-8 rounded-full shadow-sm"
        aria-label={label}
        onClick={onClick}
      >
        <Icon className="h-4 w-4 rtl:rotate-180" aria-hidden />
      </Button>
    </div>
  );
}

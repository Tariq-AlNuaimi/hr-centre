"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Deep-linkable tabs (`?tab=`), the AntD Tabs + `useTabParam` replacement.
 * Real tablist semantics; arrow keys move between tabs.
 */
export function Tabs({
  tabs,
  param = "tab",
}: {
  tabs: { key: string; label: ReactNode; content: ReactNode; hidden?: boolean }[];
  param?: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const visible = tabs.filter((t) => !t.hidden);
  const active = visible.find((t) => t.key === search.get(param))?.key ?? visible[0]?.key;
  const select = (key: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set(param, key);
    router.replace(`?${sp.toString()}`, { scroll: false });
  };
  return (
    <div>
      <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {visible.map((t, i) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            id={`tab-${t.key}`}
            aria-selected={t.key === active}
            aria-controls={`panel-${t.key}`}
            tabIndex={t.key === active ? 0 : -1}
            onKeyDown={(e) => {
              const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (d) select(visible[(i + d + visible.length) % visible.length].key);
            }}
            onClick={() => select(t.key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              t.key === active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {visible.map((t) =>
        t.key === active ? (
          <div key={t.key} role="tabpanel" id={`panel-${t.key}`} aria-labelledby={`tab-${t.key}`}>
            {t.content}
          </div>
        ) : null,
      )}
    </div>
  );
}

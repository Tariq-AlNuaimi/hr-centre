"use client";

import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { stageRank, type Stage } from "@/lib/hiring/stage-rules";

/** A list row's quick actions: shortlist (before the shortlist) and reject. */
export function RowMenu({
  row,
  onShortlist,
  onReject,
}: {
  row: { name: string; stage: string };
  onShortlist: () => void;
  onReject: () => void;
}) {
  const t = useTranslations("hiring.candidates");
  const rank = stageRank(row.stage as Stage);
  const closed = row.stage === "REJECTED" || row.stage === "WITHDRAWN";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={t("rowActions", { name: row.name })}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {rank >= 0 && rank < stageRank("SHORTLISTED") ? (
          <>
            <DropdownMenuItem onSelect={onShortlist}>{t("shortlist")}</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          className="text-destructive-emphasis"
          disabled={closed}
          onSelect={onReject}
        >
          {t("reject")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

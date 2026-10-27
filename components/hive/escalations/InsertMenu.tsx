"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiClient } from "@/lib/api-client";

type Snippet = { id: string; title: string; body: string };

/**
 * "Insert" for a draft answer (UX review tickets P1-4): the pair's saved
 * replies and the shared ones, then reference snippets from what Siraaj
 * answers from (discount partners). Inserting appends; nothing is sent until
 * the usual submit-and-approve.
 */
export function InsertMenu({
  pairId,
  onInsert,
}: {
  pairId: string | null;
  onInsert: (text: string) => void;
}) {
  const t = useTranslations("hive.escalations.insert");
  const q = useQuery({
    queryKey: ["hive", "saved-replies", pairId],
    queryFn: () =>
      apiClient.get<{ replies: Snippet[]; snippets: Snippet[] }>(
        `/api/hive/saved-replies${pairId ? `?pairId=${encodeURIComponent(pairId)}` : ""}`,
      ),
    staleTime: 60_000,
  });
  const replies = q.data?.replies ?? [];
  const snippets = q.data?.snippets ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={q.isLoading}>
          {t("button")}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-80 overflow-y-auto">
        <DropdownMenuLabel>{t("replies")}</DropdownMenuLabel>
        {replies.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("noReplies")}</p>
        ) : (
          replies.map((r) => (
            <DropdownMenuItem key={r.id} onSelect={() => onInsert(r.body)}>
              {r.title}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("reference")}</DropdownMenuLabel>
        {snippets.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("noReference")}</p>
        ) : (
          snippets.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => onInsert(s.body)}>
              {s.title}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { FilterSelect } from "@/components/shared/FilterBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";

type Reply = {
  id: string;
  title: string;
  body: string;
  hrPair: { id: string; name: string } | null;
};
type Draft = { id: string | null; title: string; body: string; hrPairId: string };
const EMPTY: Draft = { id: null, title: "", body: "", hrPairId: "" };

/**
 * Saved replies (UX review tickets P1-4): the answers HR reuse, shared or for
 * one HR pair. Inserted into a draft from the ticket page; never sent without
 * the usual submit-and-approve.
 */
export function SavedRepliesManager() {
  const t = useTranslations("hive.savedReplies");
  const { success, error } = useNotify();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const list = useQuery({
    queryKey: ["hive", "saved-replies", "all"],
    queryFn: () => apiClient.get<{ replies: Reply[] }>("/api/hive/saved-replies"),
  });
  const pairs = useQuery({
    queryKey: ["hive", "pairs"],
    queryFn: () => apiClient.get<Array<{ id: string; name: string }>>("/api/hive/pairs"),
  });

  async function save() {
    setBusy(true);
    try {
      const body = { title: draft.title, body: draft.body, hrPairId: draft.hrPairId || null };
      if (draft.id) await apiClient.put(`/api/hive/saved-replies/${draft.id}`, body);
      else await apiClient.post("/api/hive/saved-replies", body);
      success(t("saved"));
      setDraft(EMPTY);
      await queryClient.invalidateQueries({ queryKey: ["hive", "saved-replies"] });
    } catch (e) {
      error(e instanceof ApiError ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await apiClient.delete(`/api/hive/saved-replies/${id}`);
      success(t("deleted"));
      await queryClient.invalidateQueries({ queryKey: ["hive", "saved-replies"] });
    } catch (e) {
      error(e instanceof ApiError ? e.message : t("saveFailed"));
    }
  }

  const replies = list.data?.replies ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SectionCard title={draft.id ? t("editTitle") : t("newTitle")}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1">
              <Label htmlFor="reply-title">{t("replyTitle")}</Label>
              <Input
                id="reply-title"
                value={draft.title}
                maxLength={120}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <FilterSelect
              id="reply-pair"
              label={t("pair")}
              allLabel={t("everyPair")}
              value={draft.hrPairId}
              onChange={(v) => setDraft({ ...draft, hrPairId: v })}
              options={(pairs.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="reply-body">{t("body")}</Label>
            <textarea
              id="reply-body"
              value={draft.body}
              maxLength={5000}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              className="min-h-32 w-full rounded-md border border-input bg-background p-3 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !draft.title.trim() || !draft.body.trim()}>
              {draft.id ? t("update") : t("add")}
            </Button>
            {draft.id ? (
              <Button type="button" variant="ghost" onClick={() => setDraft(EMPTY)}>
                {t("cancel")}
              </Button>
            ) : null}
          </div>
        </form>
      </SectionCard>

      <SectionCard title={t("listTitle")}>
        {list.isLoading ? (
          <div className="h-24 animate-pulse rounded-md bg-muted" />
        ) : list.isError ? (
          <p role="alert" className="m-0 text-sm text-destructive-emphasis">
            {t("loadFailed")}
          </p>
        ) : replies.length === 0 ? (
          <EmptyState description={t("empty")} />
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {replies.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 font-medium text-foreground">{r.title}</p>
                  <p className="m-0 text-xs text-muted-foreground">
                    {r.hrPair?.name ?? t("everyPair")}
                  </p>
                  <p className="m-0 mt-1 line-clamp-2 whitespace-pre-line text-sm text-muted-foreground">
                    {r.body}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraft({
                        id: r.id,
                        title: r.title,
                        body: r.body,
                        hrPairId: r.hrPair?.id ?? "",
                      })
                    }
                  >
                    {t("edit")}
                  </Button>
                  <ConfirmAction
                    title={t("deleteTitle")}
                    description={t("deleteBody")}
                    okText={t("delete")}
                    okType="danger"
                    onConfirm={() => void remove(r.id)}
                  >
                    <Button size="sm" variant="ghost">
                      {t("delete")}
                    </Button>
                  </ConfirmAction>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

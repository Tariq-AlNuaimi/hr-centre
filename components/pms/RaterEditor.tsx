"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api-client";

/**
 * §9.6 — "HR reviews and **edits** assignments before launch."
 *
 * ## Why this exists
 *
 * `POST /api/three-sixty/assignments` (set one ratee's raters) had no caller.
 * HR could regenerate the whole mapping from the reporting lines or accept what
 * it produced — nothing in between, so the "edits" half of §9.6 did not exist
 * (`docs/verification/SPEC-REDTEAM.md`, F5).
 *
 * That is not cosmetic. §9.4 wants exactly three raters each and §9.7 refuses to
 * activate while anyone is short, and the generator can only draw peers from the
 * ratee's own department or a shared project. In a department of three there
 * simply are not three eligible colleagues, so the cycle reaches the activation
 * gate and stops with no way through. This is the way through.
 *
 * ## Replace, not add
 *
 * The route takes the whole rater list and replaces it, which is why this dialog
 * edits a list rather than offering "add" and "remove" as separate acts: the set
 * HR sees on screen is the set that will exist, rather than the outcome of a
 * sequence of operations that can half-apply.
 *
 * ## What it refuses, and where
 *
 * Self-assessment (§7.1 is where that lives), C-Level (§8.3 excuses them
 * entirely) and leavers (§12.1) are all refused by the route. The dialog filters
 * the obvious ones out of the picker so they are never offered, but it does not
 * re-implement the rules — the route stays the control.
 */

type Person = { id: string; name: string; email?: string; status?: string; roleTrack?: string };

export function RaterEditor({
  threeSixtyCycleId,
  ratee,
  currentRaters,
  onClose,
}: {
  threeSixtyCycleId: string;
  ratee: { id: string; name: string } | null;
  currentRaters: Person[];
  onClose: () => void;
}) {
  const t = useTranslations("pms.raterEditor");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [staged, setStaged] = useState<Person[] | null>(null);

  // Null until HR touches something, so reopening a row always shows the server's
  // current answer rather than a stale edit from a previous open.
  const raters = staged ?? currentRaters;

  const people = useQuery({
    queryKey: ["pms", "employees", "raterSearch", search],
    queryFn: () =>
      apiClient.get<{ data: Person[] }>(
        `/api/employees?pageSize=10&status=ACTIVE&search=${encodeURIComponent(search)}`,
      ),
    enabled: ratee !== null && search.trim().length > 1,
  });

  const candidates = useMemo(() => {
    const taken = new Set([ratee?.id, ...raters.map((r) => r.id)]);
    return (people.data?.data ?? []).filter((p) => !taken.has(p.id));
  }, [people.data, raters, ratee]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post("/api/three-sixty/assignments", {
        threeSixtyCycleId,
        rateeId: ratee?.id,
        raterIds: raters.map((r) => r.id),
      }),
    onSuccess: () => {
      toast.success(t("savedToast", { name: ratee?.name ?? "" }));
      void queryClient.invalidateQueries({ queryKey: ["pms", "360", "assignments"] });
      setStaged(null);
      setSearch("");
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog
      open={ratee !== null}
      onOpenChange={(open) => {
        if (!open) {
          setStaged(null);
          setSearch("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title", { name: ratee?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("help")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{t("current")}</span>
              {/* §9.4's count, said plainly rather than left to be counted. */}
              <Badge variant={raters.length === 3 ? "success" : "warning"}>
                {t("count", { count: raters.length })}
              </Badge>
            </div>
            {raters.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noneYet")}</p>
            ) : (
              <ul className="space-y-2">
                {raters.map((rater) => (
                  <li
                    key={rater.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border p-2"
                  >
                    <span className="text-sm">{rater.name}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setStaged(raters.filter((r) => r.id !== rater.id))}
                    >
                      {t("remove")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="rater-search">{t("addLabel")}</Label>
            <Input
              id="rater-search"
              value={search}
              placeholder={t("searchPlaceholder")}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search.trim().length > 1 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {candidates.length === 0 && !people.isLoading ? (
                  <li className="p-2 text-sm text-muted-foreground">{t("noMatches")}</li>
                ) : (
                  candidates.map((person) => (
                    <li key={person.id}>
                      <button
                        type="button"
                        onClick={() => setStaged([...raters, person])}
                        className="w-full rounded-md border border-border p-2 text-start text-sm hover:bg-muted"
                      >
                        {person.name}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
            {/* The picker offers anyone active; the ROUTE decides. Saying so
                keeps the screen honest about who holds the rule. */}
            <p className="text-xs text-muted-foreground">{t("pickerNote")}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("cancel")}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

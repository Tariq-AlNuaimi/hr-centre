"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmployeePicker, type PickablePerson } from "@/components/pms/EmployeePicker";
import { apiClient } from "@/lib/api-client";

/**
 * §9.6's optional project mapping — "ability to create projects and link
 * employees, so peers can be drawn from shared project work."
 *
 * ## Why this exists
 *
 * `GET`/`POST /api/projects` had no caller at all, so the peer pool could only
 * ever be someone's own department (`docs/verification/SPEC-REDTEAM.md`, F5).
 * That is precisely the case §9.6 exists to solve: in a department of three
 * there are not three eligible peers, and the people who actually worked with a
 * ratee are on their project, not their org chart.
 *
 * ## Deliberately thin, and it should stay that way
 *
 * A name and a membership list. §14 hands projects to a separate system in v2,
 * so anything more here is work thrown away — and the route's own comment says
 * the same. Membership is REPLACED on save rather than diffed, so what is on
 * screen is what will exist.
 */

type Member = PickablePerson & { odooId?: string };
type Project = { id: string; name: string; members: Member[] };

export function ProjectMap({ cycleId }: { cycleId: string }) {
  const t = useTranslations("pms.projects");
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const projects = useQuery({
    queryKey: ["pms", "projects", cycleId],
    queryFn: () => apiClient.get<{ projects: Project[] }>(`/api/projects?cycleId=${cycleId}`),
  });

  const reset = () => {
    setName("");
    setMembers([]);
    setEditingId(null);
  };

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post("/api/projects", {
        cycleId,
        name: name.trim(),
        memberEmployeeIds: members.map((m) => m.id),
      }),
    onSuccess: () => {
      toast.success(t("savedToast"));
      void queryClient.invalidateQueries({ queryKey: ["pms", "projects", cycleId] });
      reset();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = projects.data?.projects ?? [];

  return (
    <div className="space-y-6">
      <SectionCard
        title={t("title")}
        subtitle={t("help")}
        actions={
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || name.trim().length === 0}
          >
            {mutation.isPending ? t("saving") : editingId ? t("saveEdit") : t("create")}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="max-w-md space-y-1">
            <Label htmlFor="project-name">{t("nameLabel")}</Label>
            <Input
              id="project-name"
              value={name}
              placeholder={t("namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
            />
            {/* Saving under a name that already exists REPLACES its membership —
                the route upserts on (cycle, name), so say so before they click. */}
            <p className="text-xs text-muted-foreground">{t("nameNote")}</p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{t("members")}</span>
              <Badge variant="outline">{t("memberCount", { count: members.length })}</Badge>
            </div>
            {members.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {members.map((m) => (
                  <li key={m.id}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMembers(members.filter((x) => x.id !== m.id))}
                    >
                      {m.name} ✕
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="max-w-md">
              <EmployeePicker
                id="project-search"
                label={t("addMember")}
                exclude={members.map((m) => m.id)}
                onPick={(person) => setMembers([...members, person])}
              />
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("existing")} subtitle={t("existingHelp")}>
        {projects.isError ? (
          <EmptyState description={t("loadFailed")} />
        ) : rows.length === 0 ? (
          <EmptyState description={t("none")} />
        ) : (
          <ul className="space-y-2">
            {rows.map((project) => (
              <li
                key={project.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{project.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {project.members.map((m) => m.name).join(", ") || t("noMembers")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingId(project.id);
                    setName(project.name);
                    setMembers(project.members);
                  }}
                >
                  {t("edit")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

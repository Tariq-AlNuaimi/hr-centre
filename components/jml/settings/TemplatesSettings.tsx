"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/org/NativeSelect";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess } from "../use-jml";
import { TemplateEditor, type TemplateDetail } from "./TemplateEditor";

type TemplateRow = {
  id: string;
  name: string;
  version: number;
  active: boolean;
  caseType: "JOIN" | "MOVE" | "LEAVE";
  changeType: string | null;
  criteria: Record<string, string>;
  _count: { cases: number; tasks: number };
};

/**
 * Checklist templates — one screen for joiner, mover and leaver templates.
 * Saving a definition change cuts a new version; running cases keep theirs.
 */
export function TemplatesSettings() {
  const t = useTranslations("jml.settings.templates");
  const { can, isLoading } = useJmlAccess();
  const allowed = can("jml.configure");
  const [caseType, setCaseType] = useState("");
  const [allVersions, setAllVersions] = useState(false);
  const [openId, setOpenId] = useState<string | "new" | null>(null);
  const list = useQuery({
    queryKey: ["jml", "templates", caseType, allVersions],
    queryFn: () =>
      apiClient.get<{ data: TemplateRow[] }>(
        `/api/jml/config/templates?pageSize=100${caseType ? `&caseType=${caseType}` : ""}${allVersions ? "&allVersions=true" : ""}`,
      ),
    enabled: allowed,
  });
  const detail = useQuery({
    queryKey: ["jml", "template", openId],
    queryFn: () => apiClient.get<TemplateDetail>(`/api/jml/config/templates/${openId}`),
    enabled: allowed && Boolean(openId) && openId !== "new",
  });
  const header = (
    <PageHeader
      title={t("title")}
      subtitle={t("subtitle")}
      actions={allowed ? <Button onClick={() => setOpenId("new")}>{t("add")}</Button> : undefined}
    />
  );
  if (isLoading || (allowed && list.isLoading))
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  if (!allowed)
    return (
      <div className="space-y-6">
        {header}
        <NotPermitted title={t("title")} />
      </div>
    );
  if (list.isError)
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed />
      </div>
    );
  const rows = list.data?.data ?? [];
  const noJoin = !rows.some((r) => r.caseType === "JOIN" && r.active);
  return (
    <div className="space-y-6">
      {header}
      {noJoin && !caseType ? (
        <p
          role="status"
          className="rounded-md border border-border bg-status-warn p-3 text-sm text-status-warn-fg"
        >
          {t("blocksActivation")}
        </p>
      ) : null}
      <SectionCard
        title={t("listTitle")}
        noBodyPadding
        actions={
          <div className="flex items-center gap-3">
            <NativeSelect
              aria-label={t("caseType")}
              value={caseType}
              onChange={(e) => setCaseType(e.target.value)}
            >
              <option value="">{t("allTypes")}</option>
              {(["JOIN", "MOVE", "LEAVE"] as const).map((c) => (
                <option key={c} value={c}>
                  {t(`caseTypeValue.${c}`)}
                </option>
              ))}
            </NativeSelect>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={allVersions}
                onChange={(e) => setAllVersions(e.target.checked)}
              />
              {t("allVersions")}
            </label>
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState description={t("empty")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("version")}</TableHead>
                <TableHead>{t("caseType")}</TableHead>
                <TableHead>{t("tasks")}</TableHead>
                <TableHead>{t("cases")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.version}</TableCell>
                  <TableCell>
                    {t(`caseTypeValue.${r.caseType}`)}
                    {r.changeType ? ` — ${t(`changeType.${r.changeType}`)}` : ""}
                  </TableCell>
                  <TableCell>{r._count.tasks}</TableCell>
                  <TableCell>{r._count.cases}</TableCell>
                  <TableCell>
                    <Badge variant={r.active ? "success" : "default"}>
                      {r.active ? t("active") : t("inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => setOpenId(r.id)}>
                      {t("open")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
      {openId === "new" ? (
        <TemplateEditor key="new" template={null} onClose={() => setOpenId(null)} />
      ) : openId && detail.isLoading ? (
        <LoadingBlock />
      ) : openId && detail.data ? (
        <TemplateEditor
          key={detail.data.id}
          template={detail.data}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}

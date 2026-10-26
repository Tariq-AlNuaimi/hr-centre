"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { ReferenceManager, type Row } from "@/components/hive/admin/ReferenceManager";
import { useOrgOptions } from "@/components/hive/admin/use-org-options";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";

type Config = {
  anchor: { date: string; type: "A" | "B" };
  timezone: string;
  weekendDays: number[];
};

const DAYS = [7, 1, 2, 3, 4, 5, 6] as const;

/**
 * The office rotation (HIVE §4.4): the anchor week, the weekend, the groups
 * (constant / group 1 / group 2) and which teams each covers. Siraaj's
 * `hive_office_rotation` computes every answer from these — HIVE stored the
 * anchor but read code constants; HR Centre reads what is saved here.
 */
export default function HiveRotationPage() {
  const t = useTranslations("hive.setup");
  const groups = useQuery({
    queryKey: ["hive-ref", "rotation-groups"],
    queryFn: () => apiClient.get<Row[]>("/api/hive/admin/ref/rotation-groups"),
  });
  const org = useOrgOptions(t("none"));
  const groupOptions = (groups.data ?? []).map((g) => ({ value: g.id, label: String(g.name) }));
  const groupName = (id: unknown) => groupOptions.find((g) => g.value === id)?.label ?? "—";
  const modeOptions = ["CONSTANT", "GROUP_1", "GROUP_2"].map((m) => ({
    value: m,
    label: t(`mode.${m}`),
  }));

  return (
    <>
      <PageHeader title={t("rotationTitle")} subtitle={t("rotationIntro")} />
      <div className="space-y-6">
        <ConfigCard />
        <ReferenceManager
          resource="rotation-groups"
          title={t("groups")}
          rows={groups.data}
          external
          defaults={{ name: "", mode: "GROUP_1", order: 0 }}
          fields={[
            { key: "name", label: "name", kind: "text" },
            { key: "mode", label: "mode", kind: "select", options: modeOptions },
            { key: "order", label: "order", kind: "number" },
          ]}
          columns={[
            { label: t("field.name"), render: (r) => String(r.name) },
            { label: t("field.mode"), render: (r) => t(`mode.${String(r.mode)}`) },
            { label: t("field.order"), render: (r) => String(r.order) },
          ]}
        />
        <ReferenceManager
          resource="rotation-coverage"
          title={t("rotationCoverage")}
          description={t("rotationCoverageNote")}
          defaults={{
            groupId: groupOptions[0]?.value ?? "",
            label: "",
            aliases: [],
            entityId: "",
            directorateId: "",
            departmentId: "",
          }}
          fields={[
            { key: "groupId", label: "group", kind: "select", options: groupOptions },
            { key: "label", label: "label", kind: "text" },
            { key: "aliases", label: "aliases", kind: "list", hint: "aliases" },
            {
              key: "entityId",
              label: "company",
              kind: "select",
              options: org.companyOptions,
              hint: "rotationCompany",
            },
            {
              key: "directorateId",
              label: "directorate",
              kind: "select",
              options: org.directorateOptions,
              hint: "unitLink",
            },
            {
              key: "departmentId",
              label: "department",
              kind: "select",
              options: org.departmentOptions,
            },
          ]}
          columns={[
            { label: t("field.group"), render: (r) => groupName(r.groupId) },
            { label: t("field.label"), render: (r) => String(r.label) },
            {
              label: t("field.aliases"),
              render: (r) => (
                <span className="text-xs text-muted-foreground">
                  {(r.aliases as string[]).join(", ") || "—"}
                </span>
              ),
            },
            { label: t("field.company"), render: (r) => org.companyName(r.entityId) ?? "—" },
          ]}
        />
      </div>
    </>
  );
}

function ConfigCard() {
  const t = useTranslations("hive.setup");
  const { success } = useNotify();
  const queryClient = useQueryClient();
  const config = useQuery({
    queryKey: ["hive-rotation-config"],
    queryFn: () => apiClient.get<Config>("/api/hive/admin/rotation-config"),
  });
  if (config.isLoading) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (!config.data) {
    return (
      <p role="alert" className="text-sm text-destructive-emphasis">
        {t("loadFailed")}
      </p>
    );
  }
  return (
    <ConfigForm
      initial={config.data}
      onSaved={async () => {
        success(t("saved"));
        await queryClient.invalidateQueries({ queryKey: ["hive-rotation-config"] });
      }}
    />
  );
}

function ConfigForm({ initial, onSaved }: { initial: Config; onSaved: () => Promise<void> }) {
  const t = useTranslations("hive.setup");
  const [anchorDate, setAnchorDate] = useState(initial.anchor.date);
  const [anchorType, setAnchorType] = useState(initial.anchor.type);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [weekend, setWeekend] = useState<Set<number>>(new Set(initial.weekendDays));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.put("/api/hive/admin/rotation-config", {
        anchorDate,
        anchorType,
        timezone,
        weekendDays: [...weekend],
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title={t("anchor")} subtitle={t("anchorNote")}>
      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div>
          <label htmlFor="rot-anchor" className="mb-1 block text-sm font-medium">
            {t("field.anchorDate")}
          </label>
          <Input
            id="rot-anchor"
            type="date"
            value={anchorDate}
            onChange={(e) => setAnchorDate(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="rot-type" className="mb-1 block text-sm font-medium">
            {t("field.anchorType")}
          </label>
          <NativeSelect
            id="rot-type"
            className="w-full"
            value={anchorType}
            onChange={(e) => setAnchorType(e.target.value as "A" | "B")}
          >
            <option value="A">{t("weekA")}</option>
            <option value="B">{t("weekB")}</option>
          </NativeSelect>
        </div>
        <div>
          <label htmlFor="rot-tz" className="mb-1 block text-sm font-medium">
            {t("field.timezone")}
          </label>
          <Input id="rot-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
        <fieldset className="sm:col-span-3">
          <legend className="mb-1 text-sm font-medium">{t("field.weekendDays")}</legend>
          <div className="flex flex-wrap gap-4">
            {DAYS.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={weekend.has(d)}
                  onChange={(e) =>
                    setWeekend((cur) => {
                      const next = new Set(cur);
                      if (e.target.checked) next.add(d);
                      else next.delete(d);
                      return next;
                    })
                  }
                />
                {t(`day.${d}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm text-destructive-emphasis sm:col-span-3">
            {error}
          </p>
        ) : null}
        <div className="sm:col-span-3">
          <Button type="submit" disabled={busy}>
            {busy ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

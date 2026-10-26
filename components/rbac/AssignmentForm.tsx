"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";
import { ORG_SCOPE_TYPES } from "@/lib/validations/rbac";
import { UserSearch } from "./UserSearch";
import type { RoleRow } from "./types";

type Unit = { id: string; name: string; entity?: { code: string } };

/** Assign a role to a person for a scope, optionally time-boxed (AC-F3.2). */
export function AssignmentForm({ roles }: { roles: RoleRow[] }) {
  const t = useTranslations("rbac");
  const { success } = useNotify();
  const queryClient = useQueryClient();
  const [account, setAccount] = useState<{ id: string; name: string | null; email: string } | null>(
    null,
  );
  const [roleId, setRoleId] = useState("");
  const [scopeType, setScopeType] = useState<(typeof ORG_SCOPE_TYPES)[number]>("GROUP");
  const [scopeId, setScopeId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const units = useQuery({
    queryKey: ["rbac", "units", scopeType],
    queryFn: async (): Promise<Unit[]> => {
      if (scopeType === "COMPANY") return apiClient.get<Unit[]>("/api/org/entities");
      if (scopeType === "DIRECTORATE") return apiClient.get<Unit[]>("/api/org/directorates");
      return (await apiClient.get<{ data: Unit[] }>("/api/org/departments?pageSize=100")).data;
    },
    enabled: scopeType !== "GROUP",
  });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post("/api/rbac/assignments", {
        userId: account?.id ?? "",
        roleId,
        scopeType,
        scopeId: scopeType === "GROUP" ? null : scopeId || null,
        validUntil: validUntil ? new Date(`${validUntil}T23:59:59Z`).toISOString() : null,
        note: note.trim() || null,
      });
      success(t("assigned"));
      setAccount(null);
      setNote("");
      setValidUntil("");
      await queryClient.invalidateQueries({ queryKey: ["rbac"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const label = (id: string, text: string) => (
    <label htmlFor={id} className="mb-1 block text-sm font-medium text-foreground">
      {text}
    </label>
  );

  return (
    <form
      className="space-y-3 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          {label("assign-user", t("person"))}
          <UserSearch value={account} onChange={setAccount} />
        </div>
        <div>
          {label("assign-role", t("role"))}
          <NativeSelect
            id="assign-role"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className="w-full"
          >
            <option value="">{t("choose")}</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          {label("assign-scope", t("scope"))}
          <NativeSelect
            id="assign-scope"
            value={scopeType}
            onChange={(e) => {
              setScopeType(e.target.value as (typeof ORG_SCOPE_TYPES)[number]);
              setScopeId("");
            }}
            className="w-full"
          >
            {ORG_SCOPE_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(`scopeType.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        {scopeType !== "GROUP" ? (
          <div>
            {label("assign-unit", t("unit"))}
            <NativeSelect
              id="assign-unit"
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              className="w-full"
            >
              <option value="">{t("choose")}</option>
              {(units.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.entity ? `${u.entity.code} · ${u.name}` : u.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div>
          {label("assign-until", t("validUntil"))}
          <Input
            id="assign-until"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("validUntilHint")}</p>
        </div>
        <div>
          {label("assign-note", t("note"))}
          <Input id="assign-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive-emphasis">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={busy || !account || !roleId || (scopeType !== "GROUP" && !scopeId)}
      >
        {busy ? t("saving") : t("assign")}
      </Button>
    </form>
  );
}

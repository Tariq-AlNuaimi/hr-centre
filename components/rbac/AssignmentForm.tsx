"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";
import { SCOPE_TYPES, UNITLESS_SCOPES, type ScopeTypeCode } from "@/lib/validations/rbac";
import { UserSearch } from "./UserSearch";
import { newPermissions } from "@/lib/rbac/diff";
import type { EffectiveAccess } from "./types";
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
  const [scopeType, setScopeType] = useState<ScopeTypeCode>("GROUP");
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
      if (scopeType === "HR_PAIR") return apiClient.get<Unit[]>("/api/hive/pairs");
      return (await apiClient.get<{ data: Unit[] }>("/api/org/departments?pageSize=100")).data;
    },
    enabled: !UNITLESS_SCOPES.has(scopeType),
  });

  // UX P1 R12c — what this assignment adds for this person (actions they do
  // not already hold anywhere). Scope still narrows where they apply.
  const effective = useQuery({
    queryKey: ["rbac", "effective", account?.id],
    queryFn: () =>
      apiClient.get<EffectiveAccess>(
        `/api/rbac/effective?userId=${encodeURIComponent(account?.id ?? "")}`,
      ),
    enabled: Boolean(account?.id),
  });
  const chosenRole = roles.find((r) => r.id === roleId);
  const gains =
    chosenRole && effective.data
      ? newPermissions(
          effective.data.permissions.map((p) => p.code),
          chosenRole.permissions,
        )
      : null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post("/api/rbac/assignments", {
        userId: account?.id ?? "",
        roleId,
        scopeType,
        scopeId: UNITLESS_SCOPES.has(scopeType) ? null : scopeId || null,
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
              setScopeType(e.target.value as ScopeTypeCode);
              setScopeId("");
            }}
            className="w-full"
          >
            {SCOPE_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(`scopeType.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        {!UNITLESS_SCOPES.has(scopeType) ? (
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
      {gains !== null ? (
        <p aria-live="polite" className="rounded-md bg-muted/50 p-3 text-sm text-foreground">
          {gains.length === 0
            ? t("gainsNothing")
            : `${t("gains")}: ${gains.map((c) => t(`permission.${c}`)).join(", ")}`}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-emphasis">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={busy || !account || !roleId || (!UNITLESS_SCOPES.has(scopeType) && !scopeId)}
      >
        {busy ? t("saving") : t("assign")}
      </Button>
    </form>
  );
}

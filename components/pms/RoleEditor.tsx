"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEntityList } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";

/**
 * Grant and revoke HR roles — spec §4.1 (who holds what) and §4.3 (roles are
 * ADDITIVE: a person may hold several, and permissions merge "most access wins").
 *
 * The write is a whole-set PUT, not a delta, matching the route: a grant and a
 * revoke in one action are the same operation, and two clients cannot disagree
 * about the order they were applied in. The checkbox list therefore reads as
 * "this is the set this person will hold", which is also what makes the
 * unchecked boxes meaningful.
 *
 * Self-revoke of HR_SUPER_ADMIN is answered by the route with a 409 and a
 * sentence explaining why (that role is the only one that can grant itself). The
 * control stays enabled and the server's own message is surfaced verbatim: a
 * hidden control would teach the operator nothing, and a client-side guard would
 * be a second copy of a rule that already lives in one place.
 */

const PMS_ROLES = ["HR_SUPER_ADMIN", "HRBP", "EXECUTIVE_VIEWER"] as const;
type PmsRole = (typeof PMS_ROLES)[number];

export interface RoleEmployeeRow {
  id: string;
  name: string;
  email: string;
  entity: { id: string; code: string; name: string };
  /**
   * OPTIONAL, and absent today: the directory serialiser
   * (lib/pms/employee-select.ts `serializeEmployee`) does not emit `pmsRoles`,
   * so a freshly loaded row carries no role information. The component treats
   * "absent" as UNKNOWN rather than as "no roles" — see `rolesFor` — because
   * rendering an empty set for someone who is in fact an HR Super Admin would be
   * a lie the operator would then act on.
   */
  pmsRoles?: string[];
}

interface RoleEditorProps {
  /** The signed-in HR admin's own employee id, for the self-revoke note. */
  actorEmployeeId: string | null;
}

export function RoleEditor({ actorEmployeeId }: RoleEditorProps) {
  const t = useTranslations("pms");
  const tCommon = useTranslations("common");
  const { success } = useNotify();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");

  // Authoritative role sets learned from a PUT response, keyed by employee id.
  // The list endpoint does not return roles, so this is what the screen actually
  // knows rather than what it assumes.
  const [knownRoles, setKnownRoles] = useState<Record<string, string[]>>({});

  const [target, setTarget] = useState<RoleEmployeeRow | null>(null);
  const [draft, setDraft] = useState<PmsRole[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const params: Record<string, string> = {
    page: String(page),
    pageSize: String(pageSize),
    ...(search ? { search } : {}),
  };

  const { data, isLoading, isError, refetch } = useEntityList<RoleEmployeeRow>(
    "/api/employees",
    params,
    t("roles.loadFailed"),
  );

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  /** The roles we can honestly claim for a row, or `null` when unknown. */
  function rolesFor(row: RoleEmployeeRow): string[] | null {
    return knownRoles[row.id] ?? row.pmsRoles ?? null;
  }

  function openEditor(row: RoleEmployeeRow) {
    setTarget(row);
    setDraft((rolesFor(row) ?? []).filter((r): r is PmsRole => PMS_ROLES.includes(r as PmsRole)));
    setSaveError(null);
  }

  function toggle(role: PmsRole, checked: boolean) {
    setDraft((current) =>
      checked ? [...new Set([...current, role])] : current.filter((r) => r !== role),
    );
  }

  async function save() {
    if (!target) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await apiClient.put<{ id: string; name: string; pmsRoles: string[] }>(
        `/api/employees/${target.id}/pms-roles`,
        { pmsRoles: draft },
      );
      setKnownRoles((current) => ({ ...current, [target.id]: updated?.pmsRoles ?? draft }));
      success(t("roles.saved", { name: target.name }));
      setTarget(null);
    } catch (e) {
      // The route's 409 explains WHY a self-revoke is refused; that reason is
      // the whole value of the message, so it is shown as written.
      setSaveError(e instanceof ApiError ? e.message : t("roles.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    {
      key: "name",
      title: t("name"),
      dataIndex: "name",
      sorter: true,
      render: (value: string, record: RoleEmployeeRow) => (
        <div className="flex min-w-0 flex-col">
          <span className="font-medium text-foreground">{value}</span>
          <span className="truncate text-xs text-muted-foreground">{record.email}</span>
        </div>
      ),
    },
    {
      key: "entity",
      title: t("entity"),
      dataIndex: "entity",
      render: (value: RoleEmployeeRow["entity"]) => <Badge variant="default">{value.code}</Badge>,
    },
    {
      key: "pmsRoles",
      title: t("roles.currentRoles"),
      dataIndex: "pmsRoles",
      render: (_value: unknown, record: RoleEmployeeRow) => {
        const roles = rolesFor(record);
        if (roles === null) {
          return <span className="text-xs text-muted-foreground">{t("roles.rolesUnknown")}</span>;
        }
        if (roles.length === 0) {
          return <span className="text-xs text-muted-foreground">{t("roles.noRoles")}</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {roles.map((role) => (
              <Badge key={role} variant="brand">
                {t(`roles.roleName.${role}`)}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      key: "actions",
      title: t("roles.actions"),
      align: "right" as const,
      render: (_value: unknown, record: RoleEmployeeRow) => (
        <Button size="sm" variant="outline" onClick={() => openEditor(record)}>
          {t("roles.manageAction")}
        </Button>
      ),
    },
  ];

  if (isError) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive-emphasis">
          {t("roles.loadFailed")}
        </p>
        <Button variant="outline" onClick={() => refetch()}>
          {t("roles.retry")}
        </Button>
      </div>
    );
  }

  // First load gets a table-shaped skeleton rather than the DataTable's overlay
  // over an empty state — "no employees yet" is a claim, and it is not true yet.
  if (isLoading && rows.length === 0) {
    return <TableSkeleton rows={6} />;
  }

  const targetRoles = target ? rolesFor(target) : null;

  return (
    <>
      <DataTable<RoleEmployeeRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        total={total}
        page={page}
        pageSize={pageSize}
        searchable
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        onPageChange={(nextPage, nextSize) => {
          setPage(nextPage);
          setPageSize(nextSize);
        }}
        emptyText={
          <EmptyState description={search ? t("roles.noMatches") : t("roles.noEmployees")} />
        }
      />

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
            setSaveError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("roles.dialogTitle", { name: target?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("roles.dialogNote")}</DialogDescription>
          </DialogHeader>

          {targetRoles === null ? (
            // Honest about the gap rather than presenting an empty set as fact.
            <p className="text-sm text-muted-foreground">{t("roles.rolesUnknownNote")}</p>
          ) : null}

          <ul className="flex flex-col gap-4">
            {PMS_ROLES.map((role) => {
              const inputId = `pms-role-${role}`;
              const checked = draft.includes(role);
              return (
                <li key={role} className="flex items-start gap-3">
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={checked}
                    disabled={saving}
                    onChange={(e) => toggle(role, e.target.checked)}
                    className="mt-0.5 h-4 w-4 cursor-pointer rounded border-input accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <label htmlFor={inputId} className="text-sm font-medium text-foreground">
                      {t(`roles.roleName.${role}`)}
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {t(`roles.roleHint.${role}`)}
                    </span>
                    {role === "HR_SUPER_ADMIN" &&
                    target?.id === actorEmployeeId &&
                    (targetRoles ?? []).includes("HR_SUPER_ADMIN") ? (
                      // Not a disabled control: the rule is the server's, and the
                      // operator deserves to know it before they try.
                      <span className="text-xs text-muted-foreground">
                        {t("roles.ownSuperAdminNote")}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {saveError ? (
            <p role="alert" className="text-sm text-destructive-emphasis">
              {saveError}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={saving}>
              {tCommon("cancel")}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? t("roles.saving") : t("roles.saveAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

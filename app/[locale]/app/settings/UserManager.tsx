"use client";

import * as React from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Loader2, UserPlus, Check } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
// Client-safe role tuple (no Prisma runtime import — the client/server boundary trap).
const ROLES = ["HR_ADMIN", "HIRING_MANAGER"] as const;
type Role = (typeof ROLES)[number];

// lastLoginAt is an ISO string here: a Date crossing the RSC→client boundary arrives
// as a string at runtime, so the page serializes it and we re-parse before formatting.
export type UserManagerRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  lastLoginAt: string | null;
};

// User management (UI-SPEC D.10). Reuses the existing admin-gated /api/users +
// /api/users/[id] routes for create / role-change / deactivate; the list is RSC-seeded
// and refreshed after each mutation. Client guards mirror the security invariants: you
// can't deactivate yourself, and the last HR admin can't be demoted or deactivated.
export function UserManager({ users, currentUserId }: { users: UserManagerRow[]; currentUserId: string }) {
  const t = useTranslations("settings");
  const format = useFormatter();
  const router = useRouter();

  const adminCount = users.filter((u) => u.role === "HR_ADMIN").length;

  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Add-user form
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<Role>("HIRING_MANAGER");
  const [created, setCreated] = React.useState(false);

  async function changeRole(u: UserManagerRow, next: Role) {
    if (next === u.role) return;
    // Guard: don't demote the last remaining admin.
    if (u.role === "HR_ADMIN" && next !== "HR_ADMIN" && adminCount <= 1) {
      setError(t("lastAdminGuard"));
      return;
    }
    setError(null);
    setBusyId(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? t("userError"));
      } else {
        router.refresh();
      }
    } catch {
      setError(t("userError"));
    } finally {
      setBusyId(null);
    }
  }

  async function deactivate(u: UserManagerRow) {
    if (!window.confirm(t("deactivateConfirm"))) return;
    setError(null);
    setBusyId(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? t("userError"));
      } else {
        router.refresh();
      }
    } catch {
      setError(t("userError"));
    } finally {
      setBusyId(null);
    }
  }

  async function createUser() {
    setError(null);
    setCreated(false);
    setAdding(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? t("userError"));
      } else {
        setCreated(true);
        setName("");
        setEmail("");
        setPassword("");
        setRole("HIRING_MANAGER");
        router.refresh();
      }
    } catch {
      setError(t("userError"));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("userName")}</TableHead>
            <TableHead>{t("userEmail")}</TableHead>
            <TableHead>{t("userRole")}</TableHead>
            <TableHead>{t("userLastLogin")}</TableHead>
            <TableHead className="text-end" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            const isLastAdmin = u.role === "HR_ADMIN" && adminCount <= 1;
            return (
              <TableRow key={u.id}>
                <TableCell className="font-medium text-foreground">
                  {u.name ?? "—"}
                  {isSelf && (
                    <Badge variant="outline" className="ms-2">
                      {t("you")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                <TableCell>
                  <Select
                    aria-label={t("userRole")}
                    value={u.role}
                    disabled={busyId === u.id || isLastAdmin || isSelf}
                    onChange={(e) => changeRole(u, e.target.value as Role)}
                    className="min-w-40"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`role${r}`)}
                      </option>
                    ))}
                  </Select>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground tabular-nums">
                  {u.lastLoginAt
                    ? format.dateTime(new Date(u.lastLoginAt), { year: "numeric", month: "short", day: "numeric" })
                    : t("neverSignedIn")}
                </TableCell>
                <TableCell className="text-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === u.id || isSelf || isLastAdmin}
                    onClick={() => deactivate(u)}
                  >
                    {t("deactivate")}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Add user */}
      <div className="flex flex-col gap-3 rounded-md border border-border p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <UserPlus aria-hidden className="size-4 text-accent" />
          {t("addUserTitle")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nu-name">{t("userName")}</Label>
            <Input id="nu-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nu-email">{t("userEmail")}</Label>
            <Input id="nu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nu-password">{t("passwordLabel")}</Label>
            <Input
              id="nu-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="nu-password-hint"
            />
            <p id="nu-password-hint" className="text-xs text-muted-foreground">
              {t("passwordHint")}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nu-role">{t("userRole")}</Label>
            <Select id="nu-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role${r}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={createUser}
            disabled={adding || !name.trim() || !email.trim() || password.length < 8}
          >
            {adding ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            {adding ? t("creating") : t("create")}
          </Button>
          {created && !error && (
            <span role="status" className="inline-flex items-center gap-1 text-sm text-[var(--signal-pass-ink)]">
              <Check className="size-4" /> {t("saved")}
            </span>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-[var(--signal-below-ink)]">
          {error}
        </p>
      )}
    </div>
  );
}

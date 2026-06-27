import { getTranslations, getFormatter } from "next-intl/server";
import { Send } from "lucide-react";
import { requireAdmin } from "@/lib/authz";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { listInvitations, listActiveRoleProfiles } from "@/lib/services/invitation";
import { InvitationStatus } from "@/generated/prisma/client";
import { InvitationStatusBadge } from "./InvitationStatusBadge";
import { InvitationActions } from "./InvitationActions";
import { SendInvitesPanel } from "./SendInvitesPanel";
import { InvitesFilter } from "./InvitesFilter";

const PAGE_SIZE = 20;
const VALID_STATUSES = Object.values(InvitationStatus) as string[];

// Invitations list + send (UI-SPEC D.5). RSC reads via the service (no client
// fetch); admin-only (the nav marks it adminOnly; this is the server gate). The
// send panel and per-row actions are client islands.
export default async function InvitesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { locale } = await params;
  const { page: pageParam, status: statusParam } = await searchParams;
  const session = await requireAdmin(locale);
  const orgId = session.user.orgId;

  const t = await getTranslations("invitations");
  const tStatus = await getTranslations("invitations.status");
  const format = await getFormatter();

  const page = Math.max(1, Number(pageParam) || 1);
  const status =
    statusParam && VALID_STATUSES.includes(statusParam)
      ? (statusParam as InvitationStatus)
      : undefined;

  const [{ data, total }, roleProfiles] = orgId
    ? await Promise.all([
        listInvitations(orgId, {
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
          status,
        }),
        listActiveRoleProfiles(orgId),
      ])
    : [{ data: [], total: 0 }, []];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasAny = total > 0 || Boolean(status);

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <SendInvitesPanel roleProfiles={roleProfiles} />
      </PageHeader>

      {hasAny && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <InvitesFilter current={status} />
          <span className="text-sm tabular-nums text-muted-foreground">{total}</span>
        </div>
      )}

      {data.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <span className="rounded-xl bg-secondary p-3 text-accent">
            <Send className="size-6" />
          </span>
          <div className="flex flex-col items-center gap-1.5">
            <h2 className="font-display text-lg font-semibold text-foreground">
              {t("emptyTitle")}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
          </div>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colCandidate")}</TableHead>
                <TableHead>{t("colRole")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead>{t("colSent")}</TableHead>
                <TableHead>{t("colSentBy")}</TableHead>
                <TableHead className="text-end">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">
                        {row.candidateEmail}
                      </span>
                      {row.candidateName && (
                        <span className="text-xs text-muted-foreground">
                          {row.candidateName}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="text-foreground">{row.roleTitle}</span>
                    <span className="block text-xs">{row.roleFamily}</span>
                  </TableCell>
                  <TableCell>
                    <InvitationStatusBadge
                      status={row.status}
                      label={tStatus(row.status)}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format.dateTime(row.createdAt, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.sentByName ?? t("noName")}
                  </TableCell>
                  <TableCell className="text-end">
                    <InvitationActions id={row.id} status={row.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {totalPages > 1 && (
        <nav
          className="mt-4 flex items-center justify-between text-sm text-muted-foreground"
          aria-label={t("pagination")}
        >
          <span className="tabular-nums">{t("pageOf", { page, totalPages })}</span>
          <div className="flex items-center gap-2">
            {page <= 1 ? (
              <Button variant="outline" size="sm" disabled>
                {t("prev")}
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/invites?page=${page - 1}${status ? `&status=${status}` : ""}`}>
                  {t("prev")}
                </Link>
              </Button>
            )}
            {page >= totalPages ? (
              <Button variant="outline" size="sm" disabled>
                {t("next")}
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/invites?page=${page + 1}${status ? `&status=${status}` : ""}`}>
                  {t("next")}
                </Link>
              </Button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}

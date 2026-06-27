import { getTranslations } from "next-intl/server";
import { Send, PlayCircle, CheckCircle2, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

// Dashboard (UI-SPEC D.1). Phase 1 ships the shell + honest empty states; the
// pipeline numbers light up once invites/assessments land in later phases.
export default async function DashboardPage() {
  const t = await getTranslations("dashboard");

  const tiles = [
    { key: "invitesSent", value: 0, icon: Send },
    { key: "started", value: 0, icon: PlayCircle },
    { key: "completed", value: 0, icon: CheckCircle2 },
    { key: "awaitingReview", value: 0, icon: ClipboardList },
  ] as const;

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((tile) => (
          <StatCard
            key={tile.key}
            label={t(tile.key)}
            value={tile.value}
            icon={tile.icon}
          />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("awaitingReviewTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyRow text={t("awaitingReviewEmpty")} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("activeRoles")}</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyRow text={t("activeRolesEmpty")} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t("recentActivity")}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyRow text={t("recentActivityEmpty")} />
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
      <span
        className="journey-line w-10 shrink-0"
        style={{ "--journey": "40%" } as React.CSSProperties}
      />
      {text}
    </div>
  );
}

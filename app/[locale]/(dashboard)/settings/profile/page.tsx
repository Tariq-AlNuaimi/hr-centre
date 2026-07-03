"use client";

import { useState } from "react";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";
import { useZodForm, Form, TextField } from "@/components/shared/FormField";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";

export default function ProfilePage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const { success, error: showError } = useNotify();
  const [loading, setLoading] = useState(false);

  // Mirrors the /api/users/[id]/password contract (currentPassword required,
  // newPassword 8..128) plus a client-only confirm field whose cross-field
  // match keeps its i18n message.
  const changePasswordSchema = z
    .object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8).max(128),
      confirmPassword: z.string().min(1),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
      message: t("passwordMismatch"),
      path: ["confirmPassword"],
    });

  const form = useZodForm(changePasswordSchema, {
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const user = session?.user;

  async function onChangePassword(values: z.infer<typeof changePasswordSchema>) {
    setLoading(true);
    try {
      await apiClient.put(`/api/users/${user?.id}/password`, {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      success(t("passwordChanged"));
      form.reset();
    } catch (e) {
      // Surface the server's reason (carried by ApiError) on a non-2xx; fall
      // back to the generic copy for a network/parse failure.
      showError(e instanceof ApiError ? e.message : "Failed to change password");
    } finally {
      setLoading(false);
    }
  }

  if (status === "loading") return <PageSkeleton rows={6} />;

  return (
    <>
      <PageHeader title={t("profile")} />
      <Card>
        <CardContent className="p-6">
          <DescriptionList
            columns={1}
            bordered
            items={[
              { key: "name", label: t("name"), value: user?.name ?? "-" },
              { key: "email", label: t("email"), value: user?.email ?? "-" },
              { key: "role", label: t("role"), value: user?.role ?? "-" },
            ]}
          />
        </CardContent>
      </Card>

      <Separator className="my-6" />

      <Card>
        <CardHeader>
          <CardTitle>{t("changePassword")}</CardTitle>
        </CardHeader>
        <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onChangePassword)}
            className="flex max-w-[400px] flex-col gap-4"
          >
            <TextField
              name="currentPassword"
              label={t("currentPassword")}
              type="password"
              autoComplete="current-password"
            />
            <TextField
              name="newPassword"
              label={t("newPassword")}
              type="password"
              autoComplete="new-password"
            />
            <TextField
              name="confirmPassword"
              label={t("confirmPassword")}
              type="password"
              autoComplete="new-password"
            />
            <div>
              <Button type="submit" disabled={loading}>
                {tCommon("save")}
              </Button>
            </div>
          </form>
        </Form>
        </CardContent>
      </Card>
    </>
  );
}

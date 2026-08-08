"use client";

import { useTranslations, useLocale } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useState } from "react";
import { z } from "zod";
import { apiClient } from "@/lib/api-client";
import { useZodForm, Form, TextField } from "@/components/shared/FormField";
import { Button, buttonVariants } from "@/components/ui/button";
import { AuthCard } from "@/components/shared/AuthCard";
import { useNotify } from "@/hooks/use-notify";

function ResetPasswordForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const locale = useLocale();
  const notify = useNotify();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [loading, setLoading] = useState(false);

  // Mirrors the /api/auth/reset-password contract (newPassword: 8..128) plus a
  // client-only confirm field; the cross-field match keeps its i18n message.
  const resetSchema = z
    .object({
      newPassword: z.string().min(8).max(128),
      confirmPassword: z.string().min(8),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
      message: t("passwordsMustMatch"),
      path: ["confirmPassword"],
    });

  const form = useZodForm(resetSchema, {
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  if (!token) {
    return (
      <AuthCard title={t("resetPassword")}>
        <p className="text-center text-card-foreground">{t("resetInvalidOrExpired")}</p>
        <Link
          href={`/${locale}/forgot-password`}
          className={buttonVariants({ variant: "outline", size: "lg" }) + " w-full"}
        >
          {t("requestNewLink")}
        </Link>
      </AuthCard>
    );
  }

  async function onSubmit(values: z.infer<typeof resetSchema>) {
    setLoading(true);
    try {
      // apiClient throws ApiError carrying the server's `error` message on a
      // non-2xx, so the user can tell expiry from a network error; an empty
      // message falls back to the generic copy below.
      await apiClient.post("/api/auth/reset-password", {
        token,
        newPassword: values.newPassword,
      });
      notify.success(t("resetSuccess"));
      router.push(`/${locale}/login`);
    } catch (e) {
      notify.error((e as Error).message || t("resetFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title={t("resetPassword")}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <TextField
            name="newPassword"
            label={t("password")}
            type="password"
            autoComplete="new-password"
          />
          <TextField
            name="confirmPassword"
            label={t("confirmPassword")}
            type="password"
            autoComplete="new-password"
          />
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {t("resetPassword")}
          </Button>
        </form>
      </Form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams requires a Suspense boundary during static prerender.
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

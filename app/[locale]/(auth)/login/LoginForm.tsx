"use client";

import { signIn } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { useZodForm, Form, TextField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/components/shared/AuthCard";
import { useNotify } from "@/hooks/use-notify";

// Mirrors the credentials the Auth.js `credentials` provider expects (email +
// a >=8-char password). Login has no API-route schema of its own (sign-in goes
// through next-auth), so this local schema is the client-side contract.
const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});
type LoginValues = z.infer<typeof loginSchema>;

// Credentials-only since 2026-08-21 (audit A1 removed the SSO providers), so this
// component takes no provider flags. The /scale-up SSO recipe re-adds both.
export function LoginForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const locale = useLocale();
  const notify = useNotify();
  const [loading, setLoading] = useState(false);

  const form = useZodForm(loginSchema, {
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email: values.email,
        password: values.password,
        redirect: false,
      });

      if (result?.error) {
        notify.error(t("invalidCredentials"));
      } else {
        router.push(`/${locale}`);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title={t("login")}>
      {
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <TextField name="email" label={t("email")} type="email" autoComplete="email" />
            <TextField
              name="password"
              label={t("password")}
              type="password"
              autoComplete="current-password"
            />
            <div className="-mt-1 text-end">
              <Link
                href={`/${locale}/forgot-password`}
                className="font-medium text-primary-emphasis underline-offset-4 hover:underline"
              >
                {t("forgotPasswordLink")}
              </Link>
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {t("signIn")}
            </Button>
          </form>
        </Form>
      }
    </AuthCard>
  );
}

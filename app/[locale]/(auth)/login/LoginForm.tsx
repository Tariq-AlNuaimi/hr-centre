"use client";

import { signIn } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { useZodForm, Form, TextField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useNotify } from "@/hooks/use-notify";

// Mirrors the credentials the Auth.js `credentials` provider expects (email +
// a >=8-char password). Login has no API-route schema of its own (sign-in goes
// through next-auth), so this local schema is the client-side contract.
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
type LoginValues = z.infer<typeof loginSchema>;

/**
 * Monochrome Microsoft mark — the recognizable 2x2 grid square, rendered with
 * `currentColor` so it stays on-token (no raw hex; the four-colour brand mark
 * would violate no-raw-hex-color in TSX). Inherits the button's text colour.
 */
function MicrosoftMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="size-4"
      fill="currentColor"
    >
      <rect x="1" y="1" width="8" height="8" />
      <rect x="11" y="1" width="8" height="8" />
      <rect x="1" y="11" width="8" height="8" />
      <rect x="11" y="11" width="8" height="8" />
    </svg>
  );
}

// Server-derived flags (lib/auth: ssoConfigured / ssoEnforced). Passed in so the
// secret-bearing env stays server-side; this client component only sees booleans.
export function LoginForm({
  ssoConfigured,
  ssoEnforced,
}: {
  ssoConfigured: boolean;
  ssoEnforced: boolean;
}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const locale = useLocale();
  const notify = useNotify();
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);

  const form = useZodForm(loginSchema, {
    defaultValues: { email: "", password: "" },
  });

  // When SSO is enforced, credentials are removed from the provider list
  // (lib/auth), so the password form is hidden and SSO is the only way in.
  const showCredentials = !(ssoConfigured && ssoEnforced);

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

  function onSso() {
    setSsoLoading(true);
    // Full redirect to the IdP; on return Auth.js lands the session and routes home.
    signIn("microsoft-entra-id", { callbackUrl: `/${locale}` });
  }

  return (
    <Card className="w-full max-w-[400px]">
      <CardContent className="p-6">
        <h1 className="mb-6 text-center text-h4 font-semibold text-card-foreground">
          {t("login")}
        </h1>

        {showCredentials && (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-col gap-4"
            >
              <TextField
                name="email"
                label={t("email")}
                type="email"
                autoComplete="email"
              />
              <TextField
                name="password"
                label={t("password")}
                type="password"
                autoComplete="current-password"
              />
              <div className="-mt-1 text-end">
                <Link href={`/${locale}/forgot-password`}>
                  {t("forgotPasswordLink")}
                </Link>
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {t("signIn")}
              </Button>
            </form>
          </Form>
        )}

        {ssoConfigured && (
          <>
            {showCredentials && (
              <div className="my-4 flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-sm text-muted-foreground">{t("or")}</span>
                <Separator className="flex-1" />
              </div>
            )}
            <Button
              type="button"
              onClick={onSso}
              disabled={ssoLoading}
              size="lg"
              className="w-full"
              // Primary when it's the only option, outline when it sits beside the form.
              variant={showCredentials ? "outline" : "default"}
            >
              <MicrosoftMark />
              {t("signInWithMicrosoft")}
            </Button>
            {!showCredentials && (
              <p className="mb-0 mt-4 text-center text-muted-foreground">
                {t("ssoOnlyHint")}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

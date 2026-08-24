"use client";

import { signIn } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
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
/**
 * True only once React has hydrated on the client; false during SSR and the
 * first client render.
 *
 * `useSyncExternalStore` rather than a `useState` + `useEffect` pair: React's
 * own lint rule rejects setState-in-an-effect (cascading renders), and this is
 * exactly the case the hook exists for — reading a value that genuinely differs
 * between the server snapshot and the client one.
 */
const NEVER_CHANGES = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(
    NEVER_CHANGES,
    () => true,
    () => false,
  );
}

export function LoginForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const locale = useLocale();
  const notify = useNotify();
  const [loading, setLoading] = useState(false);
  // Submission is gated on hydration. A <form> whose only submit path is an
  // onSubmit handler still submits NATIVELY if the user gets there before React
  // attaches — and a native submit on a method-less form is a GET, which puts
  // the password in the query string, in browser history, and in any Referer.
  // Reproduced with a 900ms script delay; see the QA notes. `method="post"`
  // below is the belt (credentials go in a body even if this gate is bypassed by
  // implicit submission); this is the braces.
  const hydrated = useHydrated();

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
          <form
            method="post"
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
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
            <Button type="submit" size="lg" className="w-full" disabled={loading || !hydrated}>
              {t("signIn")}
            </Button>
          </form>
        </Form>
      }
    </AuthCard>
  );
}

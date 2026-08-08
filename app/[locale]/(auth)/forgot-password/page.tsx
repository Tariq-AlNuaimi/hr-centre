"use client";

import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { useZodForm, Form, TextField } from "@/components/shared/FormField";
import { Button, buttonVariants } from "@/components/ui/button";
import { AuthCard } from "@/components/shared/AuthCard";
import { useNotify } from "@/hooks/use-notify";

// Mirrors the /api/auth/forgot-password route contract (a single email field).
const forgotSchema = z.object({ email: z.email() });
type ForgotValues = z.infer<typeof forgotSchema>;

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const notify = useNotify();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const form = useZodForm(forgotSchema, { defaultValues: { email: "" } });

  async function onSubmit(values: ForgotValues) {
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email }),
      });
      // Always show the same neutral message regardless of outcome so we don't
      // leak which emails exist. The API mirrors this behaviour.
      setSubmitted(true);
    } catch {
      notify.error(t("genericError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title={t("forgotPassword")}>
      {submitted ? (
        <>
          <p className="text-center text-card-foreground">{t("resetLinkSent")}</p>
          <Link
            href={`/${locale}/login`}
            className={buttonVariants({ variant: "outline", size: "lg" }) + " w-full"}
          >
            {t("login")}
          </Link>
        </>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <TextField name="email" label={t("email")} type="email" autoComplete="email" />
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {t("sendResetLink")}
            </Button>
            <div className="text-center">
              <Link href={`/${locale}/login`}>{t("login")}</Link>
            </div>
          </form>
        </Form>
      )}
    </AuthCard>
  );
}

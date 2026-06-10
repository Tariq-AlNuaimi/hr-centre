"use client";

import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { UserForm } from "@/components/users/UserForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { useCrud } from "@/hooks/use-crud";
import { useNotify } from "@/hooks/use-notify";
import { useState } from "react";

type UserPayload = {
  id: string;
  email: string;
  name: string;
  password?: string;
  role: string;
};

export default function NewUserPage() {
  const t = useTranslations("users");
  const router = useRouter();
  const locale = useLocale();
  const { success, error: showError } = useNotify();
  const { create } = useCrud<UserPayload>({ basePath: "/api/users" });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values: {
    email: string;
    name: string;
    password?: string;
    role: string;
  }) => {
    setLoading(true);
    try {
      await create(values);
      success(t("created"));
      router.push(`/${locale}/users`);
    } catch (err) {
      showError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader title={t("createUser")} />
      <UserForm
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/users`)}
        loading={loading}
      />
    </>
  );
}

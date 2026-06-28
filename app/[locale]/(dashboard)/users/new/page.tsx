"use client";

import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { UserForm } from "@/components/users/UserForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";

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
  const { create } = useEntityMutations<UserPayload>("/api/users");

  const handleSubmit = async (values: {
    email: string;
    name: string;
    password?: string;
    role: string;
  }) => {
    try {
      await create.mutateAsync(values);
      success(t("created"));
      router.push(`/${locale}/users`);
    } catch (err) {
      showError(err instanceof Error ? err.message : t("createFailed"));
    }
  };

  return (
    <>
      <PageHeader title={t("createUser")} />
      <UserForm
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/users`)}
        loading={create.isPending}
      />
    </>
  );
}

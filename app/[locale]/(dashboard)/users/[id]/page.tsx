"use client";

import { useTranslations, useLocale } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { UserForm } from "@/components/users/UserForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { useEntityItem, useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import { useDynamicBreadcrumb } from "@/hooks/use-breadcrumb";

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  role: string;
  password?: string;
}

export default function EditUserPage() {
  const t = useTranslations("users");
  const router = useRouter();
  const locale = useLocale();
  const params = useParams();
  const { success, error: showError } = useNotify();

  const id = params.id as string;

  const { data: user, isLoading } = useEntityItem<UserRecord>(
    "/api/users",
    id,
    t("notFound")
  );
  const { update } = useEntityMutations<UserRecord>("/api/users");

  useDynamicBreadcrumb(id, user?.name ?? user?.email ?? id);

  const handleSubmit = async (values: {
    email: string;
    name: string;
    password?: string;
    role: string;
  }) => {
    try {
      // Remove empty password
      const data = { ...values };
      if (!data.password) delete data.password;
      await update.mutateAsync({ id, data });
      success(t("updated"));
      router.push(`/${locale}/users`);
    } catch (err) {
      showError(err instanceof Error ? err.message : t("updateFailed"));
    }
  };

  if (isLoading) return <FormSkeleton fields={4} />;
  if (!user) return null;

  return (
    <>
      <PageHeader title={t("editUser")} />
      <UserForm
        initialValues={{
          email: user.email,
          name: user.name ?? "",
          role: user.role,
        }}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/users`)}
        loading={update.isPending}
        isEdit
      />
    </>
  );
}

"use client";

import { useTranslations, useLocale } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { UserForm } from "@/components/users/UserForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { useEntityItem, useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import { useDynamicBreadcrumb } from "@/hooks/use-breadcrumb";

/**
 * Edit a login — moved here from `/users/[id]` by ADR-070. `/users/[id]`
 * redirects here.
 *
 * The READ and the WRITE are deliberately different shapes. `/api/users/[id]`
 * returns the stored `role` enum; the write takes `isPlatformAdmin`. Modelling
 * that honestly (two types, not one) is what stops a `{ ...user }` spread from
 * quietly posting a field the boundary no longer accepts.
 */
interface LoginRecord {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

type UpdateLoginPayload = {
  id: string;
  email?: string;
  name?: string;
  password?: string;
  isPlatformAdmin?: boolean;
};

export default function EditLoginPage() {
  const t = useTranslations("users");
  const router = useRouter();
  const locale = useLocale();
  const params = useParams();
  const { success, error: showError } = useNotify();

  const id = params.id as string;

  const { data: user, isLoading } = useEntityItem<LoginRecord>("/api/users", id, t("notFound"));
  const { update } = useEntityMutations<UpdateLoginPayload>("/api/users");

  useDynamicBreadcrumb(id, user?.name ?? user?.email ?? id);

  const back = `/${locale}/admin/access`;

  const handleSubmit = async (values: {
    email: string;
    name: string;
    password?: string;
    isPlatformAdmin: boolean;
  }) => {
    try {
      const data: Partial<UpdateLoginPayload> = { ...values };
      // An empty password field means "leave it alone", not "set it to empty".
      if (!data.password) delete data.password;
      await update.mutateAsync({ id, data });
      success(t("updated"));
      router.push(back);
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
          // The form converts this to the checkbox via `isPlatformAdminRole`, so
          // the enum→boolean mapping stays in the one file that owns it.
          role: user.role,
        }}
        onSubmit={handleSubmit}
        onCancel={() => router.push(back)}
        loading={update.isPending}
        isEdit
      />
    </>
  );
}

"use client";

import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { UserForm } from "@/components/users/UserForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";

/**
 * Create a login — moved here from `/users/new` by ADR-070, so the create form
 * lives under the screen that owns it. `/users/new` redirects here.
 *
 * `isPlatformAdmin`, not `role`: the API takes a boolean now
 * (lib/validations/user.ts), and the payload type says so rather than leaving a
 * `string` that a caller could fill with a value nothing honours.
 */
type CreateLoginPayload = {
  id: string;
  email: string;
  name: string;
  password?: string;
  isPlatformAdmin: boolean;
};

export default function NewLoginPage() {
  const t = useTranslations("users");
  const router = useRouter();
  const locale = useLocale();
  const { success, error: showError } = useNotify();
  const { create } = useEntityMutations<CreateLoginPayload>("/api/users");

  const back = `/${locale}/admin/access`;

  const handleSubmit = async (values: {
    email: string;
    name: string;
    password?: string;
    isPlatformAdmin: boolean;
  }) => {
    try {
      await create.mutateAsync(values);
      success(t("created"));
      router.push(back);
    } catch (err) {
      showError(err instanceof Error ? err.message : t("createFailed"));
    }
  };

  return (
    <>
      <PageHeader title={t("createLogin")} />
      <UserForm
        onSubmit={handleSubmit}
        onCancel={() => router.push(back)}
        loading={create.isPending}
      />
    </>
  );
}

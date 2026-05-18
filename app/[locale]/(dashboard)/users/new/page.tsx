"use client";

import { Typography } from "antd";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { UserForm } from "@/components/users/UserForm";
import { useCrud } from "@/hooks/use-crud";
import { useNotify } from "@/hooks/use-notify";
import { useState } from "react";

const { Title } = Typography;

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
  const pathname = usePathname();
  const { success, error: showError } = useNotify();
  const { create } = useCrud<UserPayload>({ basePath: "/api/users" });
  const [loading, setLoading] = useState(false);

  const locale = pathname.startsWith("/ar") ? "ar" : "en";

  const handleSubmit = async (values: {
    email: string;
    name: string;
    password?: string;
    role: string;
  }) => {
    setLoading(true);
    try {
      await create(values);
      success("User created");
      router.push(`/${locale}/users`);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Title level={2}>{t("createUser")}</Title>
      <UserForm
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/users`)}
        loading={loading}
      />
    </>
  );
}

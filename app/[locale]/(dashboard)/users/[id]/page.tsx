"use client";

import { Typography, Spin } from "antd";
import { useTranslations } from "next-intl";
import { useRouter, usePathname, useParams } from "next/navigation";
import { UserForm } from "@/components/users/UserForm";
import { useCrud } from "@/hooks/use-crud";
import { useNotify } from "@/hooks/use-notify";
import { useDynamicBreadcrumb } from "@/hooks/use-breadcrumb";
import { useEffect, useState } from "react";

const { Title } = Typography;

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
  const pathname = usePathname();
  const params = useParams();
  const { success, error: showError } = useNotify();
  const { getById, update } = useCrud<UserRecord>({
    basePath: "/api/users",
  });

  const locale = pathname.startsWith("/ar") ? "ar" : "en";
  const id = params.id as string;

  const [user, setUser] = useState<UserRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useDynamicBreadcrumb(id, user?.name ?? user?.email ?? id);

  useEffect(() => {
    getById(id)
      .then(setUser)
      .catch(() => showError("User not found"))
      .finally(() => setLoading(false));
  }, [id, getById, showError]);

  const handleSubmit = async (values: {
    email: string;
    name: string;
    password?: string;
    role: string;
  }) => {
    setSaving(true);
    try {
      // Remove empty password
      const data = { ...values };
      if (!data.password) delete data.password;
      await update(id, data);
      success("User updated");
      router.push(`/${locale}/users`);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin size="large" />;
  if (!user) return null;

  return (
    <>
      <Title level={2}>{t("editUser")}</Title>
      <UserForm
        initialValues={{
          email: user.email,
          name: user.name ?? "",
          role: user.role,
        }}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/users`)}
        loading={saving}
        isEdit
      />
    </>
  );
}

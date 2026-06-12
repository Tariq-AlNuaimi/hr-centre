"use client";

import { useEffect, useState, useCallback } from "react";
import { Typography, Spin } from "antd";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import {
  AssessmentForm,
  type AssessmentFormValues,
} from "@/components/assessments/AssessmentForm";
import { apiClient, ApiError } from "@/lib/api-client";
import { useNotify } from "@/hooks/use-notify";

const { Title, Paragraph } = Typography;

interface CredentialSummary {
  role: string;
  username: string | null;
  hasPassword: boolean;
  hasCookie: boolean;
}
interface AssessmentDetail {
  name: string;
  targetUrl: string;
  brdText: string;
  dimensions: string[];
  maxPages: number;
  authMode: "NONE" | "FORM" | "COOKIE";
  loginUrl: string | null;
  credentials: CredentialSummary[];
}

export default function EditAssessmentPage() {
  const t = useTranslations("assessments");
  const router = useRouter();
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { success, error: showError } = useNotify();

  const [initial, setInitial] = useState<Partial<AssessmentFormValues> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const a = await apiClient.get<AssessmentDetail>(`/api/assessments/${id}`);
      setInitial({
        name: a.name,
        targetUrl: a.targetUrl,
        brdText: a.brdText,
        dimensions: a.dimensions,
        maxPages: a.maxPages,
        authMode: a.authMode,
        loginUrl: a.loginUrl ?? "",
        // Secrets are never returned — leave blank; the server keeps stored ones.
        credentials: (a.credentials ?? []).map((c) => ({
          role: c.role,
          username: c.username ?? "",
          password: "",
          cookie: "",
        })),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) router.push(`/${locale}/assessments`);
      else showError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [id, locale, router, showError, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (values: AssessmentFormValues) => {
    setSaving(true);
    try {
      await apiClient.put(`/api/assessments/${id}`, values);
      success(t("saved"));
      router.push(`/${locale}/assessments/${id}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !initial) {
    return (
      <div style={{ textAlign: "center", padding: 48 }}>
        <Spin />
      </div>
    );
  }

  return (
    <>
      <Title level={2}>{t("editAssessment")}</Title>
      <Paragraph type="secondary">{t("editIntro")}</Paragraph>
      <AssessmentForm
        initialValues={initial}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/assessments/${id}`)}
        loading={saving}
        submitLabel={t("saveChanges")}
      />
    </>
  );
}

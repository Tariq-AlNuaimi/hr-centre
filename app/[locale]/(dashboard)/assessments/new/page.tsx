"use client";

import { useState } from "react";
import { Typography } from "antd";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import {
  AssessmentForm,
  type AssessmentFormValues,
} from "@/components/assessments/AssessmentForm";
import { useCrud } from "@/hooks/use-crud";
import { useNotify } from "@/hooks/use-notify";

const { Title, Paragraph } = Typography;

interface AssessmentPayload extends AssessmentFormValues {
  id: string;
}

export default function NewAssessmentPage() {
  const t = useTranslations("assessments");
  const router = useRouter();
  const locale = useLocale();
  const { success, error: showError } = useNotify();
  const { create } = useCrud<AssessmentPayload>({ basePath: "/api/assessments" });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values: AssessmentFormValues) => {
    setLoading(true);
    try {
      const createdRow = await create(values);
      success(t("created"));
      router.push(`/${locale}/assessments/${createdRow.id}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Title level={2}>{t("newAssessment")}</Title>
      <Paragraph type="secondary">{t("newIntro")}</Paragraph>
      <AssessmentForm
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/${locale}/assessments`)}
        loading={loading}
        submitLabel={t("createAndContinue")}
      />
    </>
  );
}

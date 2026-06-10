"use client";

import { useState } from "react";
import { Form, Input, Button, Checkbox, Space, Upload, Typography } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { useNotify } from "@/hooks/use-notify";
import { DIMENSION_ORDER, DIMENSION_META } from "@/lib/testing/dimensions";

const { TextArea } = Input;
const { Text } = Typography;

export interface AssessmentFormValues {
  name: string;
  targetUrl: string;
  brdText: string;
  dimensions: string[];
}

interface AssessmentFormProps {
  initialValues?: Partial<AssessmentFormValues>;
  onSubmit: (values: AssessmentFormValues) => Promise<void> | void;
  onCancel: () => void;
  loading?: boolean;
  submitLabel: string;
}

const dimensionOptions = DIMENSION_ORDER.map((d) => ({
  label: `${DIMENSION_META[d].label}${DIMENSION_META[d].advisory ? " (advisory)" : ""}`,
  value: d,
}));

export function AssessmentForm({
  initialValues,
  onSubmit,
  onCancel,
  loading,
  submitLabel,
}: AssessmentFormProps) {
  const t = useTranslations("assessments");
  const { error: showError, success } = useNotify();
  const [form] = Form.useForm<AssessmentFormValues>();
  const [parsing, setParsing] = useState(false);

  // Read .txt/.md directly; send PDF to the server for Claude-based extraction.
  const beforeUpload: UploadProps["beforeUpload"] = async (file) => {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    try {
      setParsing(true);
      if (isPdf) {
        const base64 = await fileToBase64(file);
        const { text } = await apiClient.post<{ text: string }>("/api/assessments/parse-brd", {
          base64,
          mediaType: "application/pdf",
        });
        form.setFieldsValue({ brdText: text });
      } else {
        const text = await file.text();
        form.setFieldsValue({ brdText: text });
      }
      success(t("brdLoaded"));
    } catch (err) {
      showError(err instanceof Error ? err.message : t("brdParseFailed"));
    } finally {
      setParsing(false);
    }
    return false; // prevent antd's default upload
  };

  return (
    <Form<AssessmentFormValues>
      form={form}
      layout="vertical"
      initialValues={{ dimensions: DIMENSION_ORDER as unknown as string[], ...initialValues }}
      onFinish={onSubmit}
      style={{ maxWidth: 720 }}
    >
      <Form.Item
        name="name"
        label={t("name")}
        rules={[{ required: true, message: t("nameRequired") }]}
      >
        <Input placeholder={t("namePlaceholder")} />
      </Form.Item>

      <Form.Item
        name="targetUrl"
        label={t("targetUrl")}
        rules={[{ required: true, message: t("urlRequired") }]}
      >
        <Input placeholder="https://example.com" />
      </Form.Item>

      <Form.Item
        name="dimensions"
        label={t("dimensions")}
        rules={[{ required: true, message: t("dimensionsRequired") }]}
      >
        <Checkbox.Group options={dimensionOptions} />
      </Form.Item>

      <Form.Item
        name="brdText"
        label={t("brd")}
        extra={t("brdHint")}
      >
        <TextArea rows={10} placeholder={t("brdPlaceholder")} />
      </Form.Item>

      <Form.Item>
        <Space direction="vertical" size="small">
          <Upload beforeUpload={beforeUpload} showUploadList={false} accept=".pdf,.txt,.md,.markdown">
            <Button icon={<UploadOutlined />} loading={parsing}>
              {t("uploadBrd")}
            </Button>
          </Upload>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("uploadHint")}
          </Text>
        </Space>
      </Form.Item>

      <Form.Item>
        <Space>
          <Button type="primary" htmlType="submit" loading={loading}>
            {submitLabel}
          </Button>
          <Button onClick={onCancel}>{t("cancel")}</Button>
        </Space>
      </Form.Item>
    </Form>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      // strip the "data:...;base64," prefix
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

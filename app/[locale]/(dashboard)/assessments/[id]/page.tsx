"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Typography,
  Button,
  Space,
  Tag,
  Card,
  Alert,
  List,
  Collapse,
  Spin,
  Popconfirm,
} from "antd";
import { ThunderboltOutlined, DeleteOutlined } from "@ant-design/icons";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { apiClient, ApiError } from "@/lib/api-client";
import { useNotify } from "@/hooks/use-notify";
import { dimensionLabel } from "@/lib/testing/dimensions";
import { RunReport, type ReportRun } from "@/components/assessments/RunReport";

const { Title, Paragraph, Text } = Typography;

interface RunSummary {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  overallScore: number | null;
  summary: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface AssessmentDetail {
  id: string;
  name: string;
  targetUrl: string;
  brdText: string;
  dimensions: string[];
  owner: { name: string | null; email: string } | null;
  runs: RunSummary[];
}

const RUN_STATUS_COLOR: Record<RunSummary["status"], string> = {
  PENDING: "default",
  RUNNING: "processing",
  COMPLETED: "green",
  FAILED: "red",
};

export default function AssessmentDetailPage() {
  const t = useTranslations("assessments");
  const router = useRouter();
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { success, error: showError } = useNotify();

  const [assessment, setAssessment] = useState<AssessmentDetail | null>(null);
  const [selectedRun, setSelectedRun] = useState<ReportRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);

  const loadRunReport = useCallback(
    async (runId: string) => {
      setLoadingRun(true);
      try {
        const run = await apiClient.get<ReportRun>(`/api/runs/${runId}`);
        setSelectedRun(run);
      } catch {
        showError(t("loadFailed"));
      } finally {
        setLoadingRun(false);
      }
    },
    [showError, t]
  );

  const fetchAssessment = useCallback(
    async (autoLoadLatest = true) => {
    try {
      const data = await apiClient.get<AssessmentDetail>(`/api/assessments/${id}`);
      setAssessment(data);
      const latest = data.runs[0];
      if (autoLoadLatest && latest) loadRunReport(latest.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        showError(t("notFound"));
        router.push(`/${locale}/assessments`);
        return;
      }
      showError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  },
    [id, locale, router, showError, t, loadRunReport]
  );

  useEffect(() => {
    fetchAssessment();
  }, [fetchAssessment]);

  const handleRun = async () => {
    setRunning(true);
    setSelectedRun(null);
    try {
      const run = await apiClient.post<ReportRun>(`/api/assessments/${id}/runs`);
      setSelectedRun(run);
      if (run.status === "FAILED") {
        showError(run.error ?? t("runFailedGeneric"));
      } else {
        success(t("runComplete"));
      }
      // Refresh the history list only — we already have the fresh report.
      fetchAssessment(false);
    } catch {
      // The request may have timed out (long run) while the server keeps going —
      // refresh so a run that completed server-side still surfaces.
      showError(t("runTimeout"));
      fetchAssessment(true);
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = async () => {
    try {
      await apiClient.delete(`/api/assessments/${id}`);
      success(t("deleted"));
      router.push(`/${locale}/assessments`);
    } catch {
      showError(t("deleteFailed"));
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 48 }}>
        <Spin />
      </div>
    );
  }

  if (!assessment) return null;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Space style={{ display: "flex", justifyContent: "space-between" }} align="start">
        <div>
          <Title level={2} style={{ marginBottom: 4 }}>
            {assessment.name}
          </Title>
          <Paragraph style={{ marginBottom: 8 }}>
            <a href={assessment.targetUrl} target="_blank" rel="noopener noreferrer">
              {assessment.targetUrl}
            </a>
          </Paragraph>
          <Space wrap>
            {assessment.dimensions.map((d) => (
              <Tag key={d}>{dimensionLabel(d as never)}</Tag>
            ))}
          </Space>
        </div>
        <Space>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={running}
            onClick={handleRun}
          >
            {t("runTest")}
          </Button>
          <Popconfirm title={t("deleteConfirm")} onConfirm={handleDelete} okText={t("delete")}>
            <Button danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </Space>

      {assessment.brdText && (
        <Collapse
          items={[
            {
              key: "brd",
              label: t("brd"),
              children: (
                <Paragraph style={{ whiteSpace: "pre-wrap" }}>{assessment.brdText}</Paragraph>
              ),
            },
          ]}
        />
      )}

      {running && (
        <Alert type="info" showIcon message={t("runningMessage")} description={t("runningHint")} />
      )}

      {assessment.runs.length > 0 && (
        <Card size="small" title={t("runHistory")}>
          <List<RunSummary>
            size="small"
            dataSource={assessment.runs}
            renderItem={(run) => (
              <List.Item
                actions={[
                  <a key="view" onClick={() => loadRunReport(run.id)}>
                    {t("view")}
                  </a>,
                ]}
              >
                <Space>
                  <Tag color={RUN_STATUS_COLOR[run.status]}>{run.status}</Tag>
                  {run.status === "COMPLETED" && run.overallScore != null && (
                    <Text strong>{run.overallScore}/100</Text>
                  )}
                  <Text type="secondary">{new Date(run.createdAt).toLocaleString()}</Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      )}

      {loadingRun ? (
        <div style={{ textAlign: "center", padding: 24 }}>
          <Spin />
        </div>
      ) : selectedRun ? (
        <RunReport run={selectedRun} />
      ) : (
        !running &&
        assessment.runs.length === 0 && (
          <Alert type="info" showIcon message={t("noRunsYet")} description={t("noRunsHint")} />
        )
      )}
    </Space>
  );
}

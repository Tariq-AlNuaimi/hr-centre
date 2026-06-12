"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
import { ThunderboltOutlined, DeleteOutlined, FilePdfOutlined, EditOutlined } from "@ant-design/icons";
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
  role: string | null;
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
  const [pdfLoading, setPdfLoading] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);

  // Guards for the background poll loop: stop on unmount, and cancel a prior poll
  // when a newer run starts.
  const mountedRef = useRef(true);
  const pollTokenRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
    const myToken = ++pollTokenRef.current; // cancels any prior poll
    setRunning(true);
    setSelectedRun(null);
    const active = () => mountedRef.current && pollTokenRef.current === myToken;
    try {
      // The POST returns immediately with a PENDING run; processing happens in the
      // background. Poll the run until it reaches a terminal state.
      const run = await apiClient.post<{ id: string }>(`/api/assessments/${id}/runs`);
      fetchAssessment(false); // surface the new PENDING run in history right away

      const POLL_MS = 4000;
      const MAX_ATTEMPTS = 75; // ~5 min ceiling on the client poll
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!active()) return; // unmounted or superseded by a newer run
        let full: ReportRun;
        try {
          full = await apiClient.get<ReportRun>(`/api/runs/${run.id}`);
        } catch (pollErr) {
          // Stop on a definitive error (deleted / auth); keep polling on transient 5xx.
          if (pollErr instanceof ApiError && [401, 403, 404].includes(pollErr.status)) {
            if (active()) showError(pollErr.message);
            return;
          }
          continue;
        }
        if (!active()) return;
        if (full.status === "COMPLETED" || full.status === "FAILED") {
          setSelectedRun(full);
          if (full.status === "FAILED") showError(full.error ?? t("runFailedGeneric"));
          else success(t("runComplete"));
          fetchAssessment(false);
          return;
        }
      }
      // Still running after the ceiling — likely exceeded this plan's time limit.
      if (active()) {
        showError(t("runTimeout"));
        fetchAssessment(true);
      }
    } catch (err) {
      if (active()) showError(err instanceof Error ? err.message : t("runFailedGeneric"));
    } finally {
      if (mountedRef.current && pollTokenRef.current === myToken) setRunning(false);
    }
  };

  const handleDownloadPdf = async (runId: string) => {
    setPdfLoading(true);
    try {
      // Binary download — bypass the JSON apiClient.
      const res = await fetch(`/api/runs/${runId}/pdf`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? t("pdfFailed"));
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `vibe-inspector-${runId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      showError(e instanceof Error ? e.message : t("pdfFailed"));
    } finally {
      setPdfLoading(false);
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
          <Button icon={<EditOutlined />} onClick={() => router.push(`/${locale}/assessments/${id}/edit`)}>
            {t("edit")}
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
                  {run.role && <Tag color="purple">{run.role}</Tag>}
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
        <>
          {selectedRun.status === "COMPLETED" && (
            <div style={{ textAlign: "right" }}>
              <Button
                icon={<FilePdfOutlined />}
                loading={pdfLoading}
                onClick={() => handleDownloadPdf(selectedRun.id)}
              >
                {t("downloadPdf")}
              </Button>
            </div>
          )}
          <RunReport run={selectedRun} />
        </>
      ) : (
        !running &&
        assessment.runs.length === 0 && (
          <Alert type="info" showIcon message={t("noRunsYet")} description={t("noRunsHint")} />
        )
      )}
    </Space>
  );
}

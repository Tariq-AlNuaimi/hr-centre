"use client";

import { Empty, Button } from "antd";
import { useTranslations } from "next-intl";

interface EmptyStateProps {
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const t = useTranslations("common");

  return (
    <Empty description={description ?? t("noData")}>
      {actionLabel && onAction && (
        <Button type="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Empty>
  );
}

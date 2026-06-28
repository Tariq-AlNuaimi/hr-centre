"use client";

import { Popconfirm } from "antd";
import type { PopconfirmProps } from "antd";
import { useTranslations } from "next-intl";

interface ConfirmActionProps extends Omit<PopconfirmProps, "title"> {
  title?: string;
  children: React.ReactNode;
}

export function ConfirmAction({
  title,
  children,
  ...props
}: ConfirmActionProps) {
  const t = useTranslations("common");

  return (
    <Popconfirm
      title={title ?? t("confirm")}
      okText={t("yes")}
      cancelText={t("no")}
      {...props}
    >
      {children}
    </Popconfirm>
  );
}

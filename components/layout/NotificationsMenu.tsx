"use client";

import { Badge, Button, Popover, Empty, Typography, theme } from "antd";
import { BellOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { useState } from "react";

const { Text } = Typography;

/**
 * Header notifications bell. The template ships no notifications backend, so the
 * panel shows an HONEST empty state ("all caught up") rather than fake rows — a
 * fork wires a real feed (e.g. via /scale-up) and feeds `items` here. The count
 * badge + panel are the finished chrome; the data source is the seam.
 */
export function NotificationsMenu() {
  const t = useTranslations("chrome");
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);

  // No feed yet — keep this empty (honest) until a real source is wired.
  const count = 0;

  const content = (
    <div style={{ inlineSize: 300 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBlockEnd: token.paddingXS,
          marginBlockEnd: token.marginXS,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Text strong>{t("notifications")}</Text>
      </div>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span>
            <div>{t("noNotifications")}</div>
            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {t("noNotificationsHint")}
            </Text>
          </span>
        }
        style={{ paddingBlock: token.paddingLG, marginInline: 0 }}
      />
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
      arrow={false}
    >
      <Badge count={count} size="small" offset={[-2, 2]}>
        <Button
          type="text"
          shape="circle"
          icon={<BellOutlined />}
          aria-label={t("notifications")}
        />
      </Badge>
    </Popover>
  );
}

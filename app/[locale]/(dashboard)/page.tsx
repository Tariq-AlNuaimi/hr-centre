"use client";

import { Typography, Card, Row, Col } from "antd";
import {
  UserOutlined,
  FileOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useTranslations } from "next-intl";

const { Title } = Typography;

export default function DashboardPage() {
  const t = useTranslations("nav");
  const tDash = useTranslations("dashboard");

  return (
    <>
      <Title level={2}>{t("home")}</Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={8}>
          <Card hoverable>
            <Card.Meta
              avatar={<UserOutlined style={{ fontSize: 24 }} />}
              title={t("users")}
              description={tDash("usersDescription")}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card hoverable>
            <Card.Meta
              avatar={<FileOutlined style={{ fontSize: 24 }} />}
              title={tDash("resources")}
              description={tDash("resourcesDescription")}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card hoverable>
            <Card.Meta
              avatar={<SettingOutlined style={{ fontSize: 24 }} />}
              title={t("settings")}
              description={tDash("settingsDescription")}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}

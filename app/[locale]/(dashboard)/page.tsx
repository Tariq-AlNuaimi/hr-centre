"use client";

import { Typography, Card, Row, Col } from "antd";
import {
  UserOutlined,
  FileOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useTranslations } from "next-intl";

const { Title, Paragraph } = Typography;

export default function DashboardPage() {
  const t = useTranslations("nav");

  return (
    <>
      <Title level={2}>{t("home")}</Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={8}>
          <Card hoverable>
            <Card.Meta
              avatar={<UserOutlined style={{ fontSize: 24 }} />}
              title={t("users")}
              description="Manage application users and roles"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card hoverable>
            <Card.Meta
              avatar={<FileOutlined style={{ fontSize: 24 }} />}
              title="Resources"
              description="Add your entity cards here"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card hoverable>
            <Card.Meta
              avatar={<SettingOutlined style={{ fontSize: 24 }} />}
              title={t("settings")}
              description="Application configuration"
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}

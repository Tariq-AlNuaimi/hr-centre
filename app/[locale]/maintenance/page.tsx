"use client";

import { Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { BrandedStatus } from "@/components/shared/BrandedStatus";

// Branded scheduled-maintenance screen. Ships as a ready page; to actually gate
// the app behind it (e.g. via an env flag + middleware), add `/maintenance` to
// the public-path allowlist — that's an Ask-before change (middleware.ts), wired
// per /scale-up when a fork needs a maintenance window.
export default function MaintenancePage() {
  const tStatus = useTranslations("status");

  return (
    <BrandedStatus
      minHeight="100vh"
      icon={<Wrench />}
      title={tStatus("maintenanceTitle")}
      subtitle={tStatus("maintenanceSubtitle")}
    />
  );
}

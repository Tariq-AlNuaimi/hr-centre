"use client";

import { useEffect } from "react";
import { useBreadcrumb } from "@/components/layout/BreadcrumbProvider";

/** Name a record's id segment in the breadcrumb (a candidate's name, a requisition's title). */
export function useCrumb(segment: string, label: string | null | undefined) {
  const { setDynamicLabel } = useBreadcrumb();
  useEffect(() => {
    if (label) setDynamicLabel(segment, label);
  }, [segment, label, setDynamicLabel]);
}

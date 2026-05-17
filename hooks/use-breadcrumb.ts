"use client";

import { useEffect } from "react";
import { useBreadcrumb as useBreadcrumbContext } from "@/components/layout/BreadcrumbProvider";

/**
 * Set a dynamic breadcrumb label for a route segment (e.g. a user's name for /users/[id]).
 */
export function useDynamicBreadcrumb(segment: string, label: string) {
  const { setDynamicLabel } = useBreadcrumbContext();

  useEffect(() => {
    if (segment && label) {
      setDynamicLabel(segment, label);
    }
  }, [segment, label, setDynamicLabel]);
}

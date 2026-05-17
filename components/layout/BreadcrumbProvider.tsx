"use client";

import { createContext, useCallback, useContext, useState } from "react";

interface BreadcrumbContextValue {
  dynamicLabels: Record<string, string>;
  setDynamicLabel: (segment: string, label: string) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  dynamicLabels: {},
  setDynamicLabel: () => {},
});

export function useBreadcrumb() {
  return useContext(BreadcrumbContext);
}

export function BreadcrumbProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [dynamicLabels, setDynamicLabels] = useState<Record<string, string>>(
    {}
  );

  const setDynamicLabel = useCallback((segment: string, label: string) => {
    setDynamicLabels((prev) => ({ ...prev, [segment]: label }));
  }, []);

  return (
    <BreadcrumbContext.Provider value={{ dynamicLabels, setDynamicLabel }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

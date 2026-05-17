"use client";

import { useCallback } from "react";
import { App } from "antd";

export function useNotify() {
  const { message, notification } = App.useApp();

  const success = useCallback((content: string) => message.success(content), [message]);
  const error = useCallback((content: string) => message.error(content), [message]);
  const info = useCallback((content: string) => message.info(content), [message]);
  const warning = useCallback((content: string) => message.warning(content), [message]);

  return { success, error, info, warning, notify: notification };
}

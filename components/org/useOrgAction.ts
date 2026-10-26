"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNotify } from "@/hooks/use-notify";
import { ApiError } from "@/lib/api-client";

/**
 * One write against the org structure: run it, toast the outcome honestly (the
 * server's refusal sentence, never a generic success over a failure), and
 * refresh every org list — a rename or retire changes counts on its parent too.
 */
export function useOrgAction(fallbackError: string) {
  const queryClient = useQueryClient();
  const { success, error } = useNotify();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, successMessage: string): Promise<boolean> {
    setBusy(true);
    try {
      await action();
      success(successMessage);
      await queryClient.invalidateQueries({ queryKey: ["org"] });
      return true;
    } catch (e) {
      error(e instanceof ApiError ? e.message : fallbackError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { run, busy };
}

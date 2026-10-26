import type { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok } from "@/lib/api-response";
import { requireHivePermission } from "@/lib/hive/services/permissions";
import { MAX_PROVIDER_FILE_BYTES, importProviders } from "@/lib/hive/services/setup";
import { ruleErrorResponse } from "@/lib/org/http";

/**
 * Upload the insurance network provider spreadsheet (.xlsx) — the screen form
 * of `npm run hive:providers` (same parser, same rules; `replace=1` retires the
 * current list first, audited and restorable). `tickets.configure`.
 */
export const POST = withRateLimit(
  withAuth(
    requireHivePermission("configure", async (req: NextRequest) => {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return err("Upload the spreadsheet as a form file.", 400);
      }
      const file = form.get("file");
      if (!(file instanceof File)) return err("Choose an .xlsx file.", 400);
      if (file.size > MAX_PROVIDER_FILE_BYTES) return err("The file is larger than 5 MB.", 413);
      if (!/\.xlsx$/i.test(file.name)) return err("Upload an Excel .xlsx file.", 400);
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        return ok(await importProviders(buffer, form.get("replace") === "1"));
      } catch (e) {
        return ruleErrorResponse(e);
      }
    }),
  ),
  { id: "hive-provider-import", limit: 10, windowMs: 60_000 },
);

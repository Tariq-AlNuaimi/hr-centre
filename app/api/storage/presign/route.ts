import { NextRequest } from "next/server";
import { getPresignedUploadUrl } from "@/lib/storage";
import { withAuth } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import crypto from "node:crypto";

export const GET = withAuth(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const filename = searchParams.get("filename");
  const contentType = searchParams.get("contentType");

  if (!filename || !contentType) {
    return err("filename and contentType are required");
  }

  const date = new Date().toISOString().split("T")[0];
  const uuid = crypto.randomUUID();
  const key = `uploads/${date}/${uuid}-${filename}`;

  const url = await getPresignedUploadUrl(key, contentType);

  return ok({ url, key });
});

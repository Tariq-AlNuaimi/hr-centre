import type { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, notFound } from "@/lib/api-response";
import { documentAccess } from "@/lib/core/documents/access";
import { DocumentError, uploadEmployeeDocument } from "@/lib/core/documents/store";
import { documentUploadSchema } from "@/lib/validations/core/documents";

/** Upload a file to a person's record (ADR-098). Multipart: file, title, category, restricted. */
export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const access = await documentAccess(session, id);
    if (!access) return notFound("Employee");
    if (!access.edit) return err("You can't add documents to this person's record.", 403);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return err("Attach the file to upload.", 400);
    const parsed = documentUploadSchema.safeParse({
      title: form?.get("title"),
      category: form?.get("category"),
      restricted: form?.get("restricted") ?? undefined,
    });
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid document", 422);
    if (parsed.data.restricted && !access.restricted)
      return err("Only someone with pay access can add a restricted document.", 403);
    try {
      return created(
        await uploadEmployeeDocument({
          employeeId: id,
          file,
          ...parsed.data,
          uploadedById: session.user.id,
        }),
      );
    } catch (e) {
      if (e instanceof DocumentError) return err(e.message, e.status);
      throw e;
    }
  }),
  { id: "employee-documents-upload", limit: 20, windowMs: 60_000 },
);

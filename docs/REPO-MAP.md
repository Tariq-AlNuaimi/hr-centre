# Repo map (generated -- do not edit; `node scripts/repo-map.mjs`)

## Routes (app/)
- app/[locale]/(auth)/forgot-password/page.tsx
- app/[locale]/(auth)/login/page.tsx
- app/[locale]/(auth)/reset-password/page.tsx
- app/[locale]/(dashboard)/audit-log/page.tsx
- app/[locale]/(dashboard)/page.tsx
- app/[locale]/(dashboard)/recycling-bin/page.tsx
- app/[locale]/(dashboard)/settings/page.tsx
- app/[locale]/(dashboard)/settings/profile/page.tsx
- app/[locale]/(dashboard)/style-guide/page.tsx
- app/[locale]/(dashboard)/users/[id]/page.tsx
- app/[locale]/(dashboard)/users/new/page.tsx
- app/[locale]/(dashboard)/users/page.tsx
- app/api/audit-log/route.ts  [GET]
- app/api/auth/[...nextauth]/route.ts  [GET]
- app/api/auth/forgot-password/route.ts
- app/api/auth/reset-password/route.ts
- app/api/health/route.ts
- app/api/internal/audit-purge/route.ts  [GET,POST]
- app/api/recycling-bin/[entityType]/[id]/route.ts  [DELETE]
- app/api/recycling-bin/route.ts  [GET,POST]
- app/api/users/[id]/password/route.ts  [PUT]
- app/api/users/[id]/route.ts  [GET,PUT,DELETE]
- app/api/users/route.ts  [GET,POST]
- app/page.tsx

## Models (prisma/schema.prisma)
- User: id, email, emailVerified, name, passwordHash, image, role, lastLoginAt, deletedAt, deletedBy, createdAt, updatedAt, accounts, sessions, auditLogs
- Account: id, userId, type, provider, providerAccountId, refresh_token, access_token, expires_at, token_type, scope, id_token, session_state, user
- Session: id, sessionToken, userId, expires, user
- VerificationToken: identifier, token, expires
- AuditLog: id, entityType, entityId, action, before, after, changes, userId, user, ipAddress, userAgent, timestamp

## lib/ exports
- lib/api-client.ts: ApiError, ApiClientOptions, apiClient
- lib/api-helpers.ts: withAuth, withAdminAuth, withEditorAuth, withInternalAuth, withRateLimit, withApiAuth
- lib/api-response.ts: ApiResponse, ok, created, err, notFound, forbidden, unauthorized
- lib/audit-context.ts: AuditContext, auditStorage, withAuditContext, getAuditContext
- lib/auth.ts: mapSsoRole
- lib/email.ts: SendEmailOptions, SendEmailResult, isEmailEnabled, buildMailOptions, sendEmail
- lib/env.ts: env
- lib/export.ts: ExportColumn, ToExcelOptions, toExcel, excelDownloadHeaders
- lib/pagination.ts: PaginationParams, PaginatedResponse, parsePagination, paginatedResponse
- lib/password.ts: BCRYPT_COST, hashPassword
- lib/prisma/audit-extension.ts: SCRUB_FIELDS, scrub, recordAudit, computeChanges, auditExtension
- lib/prisma/recyclable.ts: RecyclableRecord, RECYCLABLE_ENTITY_TYPES, recyclableAccessor, RecyclableDelegate
- lib/prisma/soft-delete-extension.ts: softDeleteExtension, registerSoftDeleteModel
- lib/prisma.ts: prisma, prismaUnfiltered
- lib/rate-limit.ts: RateLimitOptions, RateLimitResult, rateLimit
- lib/sentry.ts: _setSentryForTesting, scrubContext, captureError, setUserContext
- lib/validations/common.ts: paginationSchema, idParamSchema, emailSchema
- lib/validations/user.ts: createUserSchema, updateUserSchema, CreateUserInput, UpdateUserInput

## components/
- components/dashboard/DashboardContent.tsx
- components/layout/AppFooter.tsx
- components/layout/AppHeader.tsx
- components/layout/AppShell.tsx
- components/layout/AppSidebar.tsx
- components/layout/BreadcrumbProvider.tsx
- components/layout/Breadcrumbs.tsx
- components/layout/ThemeProvider.tsx
- components/shared/Chart.impl.tsx
- components/shared/Chart.tsx
- components/shared/ConfirmAction.tsx
- components/shared/DataTable.tsx
- components/shared/EmptyState.tsx
- components/shared/KanbanBoard.impl.tsx
- components/shared/KanbanBoard.tsx
- components/shared/PageHeader.tsx
- components/shared/Skeletons.tsx
- components/users/UserColumns.tsx
- components/users/UserForm.tsx

# Repo map (generated -- do not edit; `node scripts/repo-map.mjs`)

## Routes (app/)
- app/[locale]/(auth)/login/page.tsx
- app/[locale]/app/audit/page.tsx
- app/[locale]/app/calibration/page.tsx
- app/[locale]/app/candidates/page.tsx
- app/[locale]/app/compare/page.tsx
- app/[locale]/app/invites/page.tsx
- app/[locale]/app/page.tsx
- app/[locale]/app/roles/page.tsx
- app/[locale]/app/settings/page.tsx
- app/[locale]/methodology/page.tsx
- app/[locale]/page.tsx
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
- Organization: id, name, slug, defaultLocale, deletedAt, deletedBy, createdAt, updatedAt, users, roleFamilies, auditLogs
- User: id, orgId, org, email, emailVerified, name, passwordHash, image, role, lastLoginAt, passwordChangedAt, deletedAt, deletedBy, createdAt, updatedAt, accounts, sessions, auditLogs
- Account: id, userId, type, provider, providerAccountId, refresh_token, access_token, expires_at, token_type, scope, id_token, session_state, user
- Session: id, sessionToken, userId, expires, user
- VerificationToken: identifier, token, expires
- RoleFamily: id, orgId, org, key, name, description, deletedAt, deletedBy, createdAt, updatedAt
- AssessmentItemBank: id, itemNumber, itemCode, domain, facet, facetNumber, keyed, text_en, text_ar, createdAt, updatedAt
- AuditLog: id, orgId, org, entityType, entityId, action, before, after, changes, userId, user, ipAddress, userAgent, timestamp

## lib/ exports
- lib/api-client.ts: ApiError, ApiClientOptions, apiClient
- lib/api-helpers.ts: withAuth, withAdminAuth, withManagerAuth, withInternalAuth, withRateLimit, withApiAuth
- lib/api-response.ts: ApiResponse, ok, created, err, notFound, forbidden, unauthorized
- lib/audit-context.ts: AuditContext, auditStorage, withAuditContext, getAuditContext
- lib/auth.ts: mapSsoRole, ssoProviderPlan, ssoConfigured, ssoEnforced
- lib/authz.ts: requireSession, requireAdmin, isAdmin
- lib/client-ip.ts: clientIp
- lib/email.ts: SendEmailOptions, SendEmailResult, isEmailEnabled, recipientLabel, buildMailOptions, sendEmail
- lib/env.ts: env
- lib/export.ts: neutralizeFormula, ExportColumn, ToExcelOptions, toExcel, excelDownloadHeaders
- lib/format.ts: formatDateTime, formatDate
- lib/pagination.ts: PaginationParams, PaginatedResponse, parsePagination, paginatedResponse
- lib/password.ts: BCRYPT_COST, hashPassword
- lib/prisma/audit-extension.ts: SCRUB_FIELDS, scrub, recordAudit, computeChanges, auditExtension
- lib/prisma/recyclable.ts: RecyclableRecord, RECYCLABLE_ENTITY_TYPES, recyclableAccessor, RecyclableDelegate, recyclableClient, permanentlyDelete
- lib/prisma/soft-delete-extension.ts: isSoftDeleteModel, applySoftDeleteFilter, softDeleteExtension, registerSoftDeleteModel
- lib/prisma.ts: prisma, prismaUnfiltered
- lib/rate-limit.ts: RateLimitOptions, RateLimitResult, rateLimit
- lib/scoring.ts: ScoringError, isScoringConfigured, requestScoring
- lib/sentry.ts: _setSentryForTesting, scrubContext, captureError, setUserContext
- lib/utils.ts: cn
- lib/validations/common.ts: paginationSchema, idParamSchema, emailSchema
- lib/validations/scoring.ts: NUM_ITEMS, big5Domains, scoreBandSchema, answerSchema, scoreRequestSchema, facetScoreSchema, domainScoreSchema, scoreResponseSchema, ScoreRequestInput, ScoreRequest, ScoreResponse, DomainScore, FacetScore, Big5Domain
- lib/validations/user.ts: createUserSchema, updateUserSchema, CreateUserInput, UpdateUserInput

## components/
- components/brand/Wordmark.tsx
- components/layout/AppShell.tsx
- components/layout/LocaleToggle.tsx
- components/layout/MobileSidebar.tsx
- components/layout/SidebarNav.tsx
- components/layout/ThemeToggle.tsx
- components/layout/UserMenu.tsx
- components/providers/ThemeProvider.tsx
- components/shared/PageHeader.tsx
- components/shared/Placeholder.tsx
- components/shared/StatCard.tsx
- components/ui/avatar.tsx
- components/ui/badge.tsx
- components/ui/button.tsx
- components/ui/card.tsx
- components/ui/dropdown-menu.tsx
- components/ui/input.tsx
- components/ui/label.tsx
- components/ui/separator.tsx
- components/ui/sheet.tsx

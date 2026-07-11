# Enterprise Benchmark v2 — Master Catalogue

Every item below gets the full 4-lens top-10 treatment per `METHODOLOGY.md`.
`[dep]` = already in `package.json` (benchmark our choice vs alternatives → keep/replace).
`[new]` = net-new capability the enterprise pivot needs (benchmark → adopt).
> Operator's own additions (the "below list" from the operator) get appended to the
> relevant category as `[op]` when provided.

## C01 — Core framework, runtime & build → `01-core-framework.md`
next@16 [dep] · react@19 / react-dom [dep] · typescript@5 [dep] · Node 22 runtime [dep] · build output/`standalone` + Turbopack/webpack [dep] · meta-framework alternatives (Remix/React-Router 7, TanStack Start, Nuxt, SvelteKit, Astro) [new] · runtime alternatives (Bun, Deno) [new] · monorepo tooling (Nx, Turborepo) [new]

## C02 — Data: ORM, Postgres, migrations, pooling, vector, backup → `02-data-layer.md`
prisma@7 / @prisma/client [dep] · @prisma/adapter-pg + pg@8 [dep] · Postgres 17 image [new] · connection pooler (PgBouncer/pgcat/Supavisor) [new] · vector store (pgvector/pgvectorscale vs Qdrant/Milvus/Weaviate/Pinecone) [new] · backup/PITR (WAL-G/pgBackRest/Barman) [new] · migration-at-startup pattern [new] · ORM alternatives (Drizzle/Kysely/TypeORM/MikroORM) [dep-alt]

## C03 — Auth & enterprise identity → `03-auth-identity.md`
next-auth@5 (Auth.js) [dep] · @auth/prisma-adapter [dep] · bcryptjs / password hashing (argon2/scrypt) [dep] · enterprise SSO SAML+OIDC (WorkOS/Stytch/Keycloak/Zitadel/Ory/Authentik/Clerk/Auth0) [new] · SCIM provisioning [new] · Entra ID (ADR-024) [dep] · auth-library alternatives (Better-Auth/Lucia/SuperTokens/Clerk) [dep-alt]

## C04 — Authorization & policy-as-code → `04-authz-policy.md`
role model / Auth.js wrappers [dep] · fine-grained ReBAC/ABAC (OpenFGA/SpiceDB/Cerbos/Oso/Casbin/Permit.io/Warrant/Topaz) [new] · policy-as-code (OPA/Conftest/Kyverno/Cedar) [new]

## C05 — UI framework & design system → `05-ui-design-system.md`
tailwindcss@4 + @tailwindcss/postcss [dep] · Radix primitives (avatar/dialog/direction/dropdown/popover/select/switch) [dep] · shadcn/ui [dep] · class-variance-authority/clsx/tailwind-merge [dep] · lucide-react icons [dep] · sonner toasts [dep] · recharts charts [dep] · style-dictionary tokens [dep] · component-lib alternatives (MUI/Chakra/Mantine/Ant Design/Park-UI/HeroUI) [dep-alt] · headless alternatives (Ark/React-Aria/Headless UI/Base UI) [dep-alt] · styling alternatives (Panda/vanilla-extract/CSS Modules) [dep-alt] · chart alternatives (visx/nivo/ECharts/Tremor) [dep-alt]

## C06 — Forms, validation, tables & data-fetching → `06-forms-validation-data.md`
react-hook-form + @hookform/resolvers [dep] · zod@3 [dep] · @tanstack/react-table [dep] · @tanstack/react-query [dep] · validation alternatives (valibot/arktype/yup/typebox/effect-schema) [dep-alt] · form alternatives (TanStack Form/Formik/Conform) [dep-alt] · data-fetching alternatives (SWR/urql) [dep-alt] · grid alternatives (AG-Grid/MUI DataGrid/Glide) [dep-alt]

## C07 — AI & agent application stack → `07-ai-agent-stack.md`
LLM provider SDK (@anthropic-ai/sdk vs Vercel AI SDK abstraction) [new] · agent/tool-runner framework (native tool-runner vs LangGraph/Mastra/LlamaIndex/CrewAI/Pydantic-AI/OpenAI-Agents-SDK/Inngest-AgentKit/VoltAgent) [new] · streaming to client in Next 16 RSC (SSE/streamText) [new] · vector store (AI lens; cross-ref C02) [new] · embeddings + retrieval (chunking/hybrid/reranking) [new] · evals + LLM-as-judge (Braintrust/Langfuse/Phoenix/Promptfoo/Openllmetry) [new] · prompt/version management [new] · guardrails/safety (Guardrails-AI/NeMo/LLM-Guard/Anthropic-native) [new] · agent background execution (Inngest/Trigger.dev/BullMQ/Temporal) [new] · per-tenant cost metering [new] · scaffold skills (/scaffold-agent, /scaffold-ai-endpoint) [new]

## C08 — i18n & localization → `08-i18n.md`
next-intl@4 [dep] · alternatives (next-i18next/react-intl-FormatJS/Lingui/Paraglide-inlang/Tolgee) [dep-alt] · RTL handling [dep] · translation management (Tolgee/Crowdin/Localazy/Weblate) [new]

## C09 — Infra, containerization & delivery → `09-infra-delivery.md`
Dockerfile/standalone image [new] · docker-compose(.prod) [new] · reverse proxy/TLS (Caddy/Traefik/Nginx) [new] · container registry (GHCR/ECR/Harbor) [new] · object storage (MinIO/Garage/SeaweedFS/S3) [new] · secrets management (Vault/Infisical/SOPS+age/sealed-secrets/Doppler) [new] · orchestration (Compose/Swarm/k8s+Helm/Nomad) [new] · IaC (Terraform/OpenTofu/Pulumi) [new] · PaaS/self-host-PaaS options (Vercel/Railway/Render/Fly/Coolify/Dokploy) [dep-alt]

## C10 — Observability: tracing, errors, metrics, logs → `10-observability.md`
@sentry/nextjs [dep] · @vercel/speed-insights [dep] · OpenTelemetry (SDK + collector, Next 16 instrumentation) [new] · tracing backend (Jaeger/Grafana Tempo/SigNoz) [new] · metrics (Prometheus/Grafana/VictoriaMetrics) [new] · logs (Loki/ELK-OpenSearch/Vector) [new] · error alt (GlitchTip) [dep-alt] · all-in-one (SigNoz/HyperDX/Highlight/OpenObserve) [new] · RUM (Grafana Faro vs Speed-Insights) [dep-alt]

## C11 — Supply chain & security scanning → `11-supplychain-security.md`
gitleaks (secret scan) [dep] · @cyclonedx/cyclonedx-npm SBOM [dep] · npm audit [dep] · trivy container/dep scan [dep] · husky hooks [dep] · secret-scan alt (trufflehog) [dep-alt] · SBOM alt (Syft/SPDX) [dep-alt] · container-scan alt (Grype/Snyk/Docker-Scout) [dep-alt] · SAST (Semgrep/CodeQL/SonarQube) [new] · dep-audit alt (Socket/Snyk/osv-scanner/Dependabot/Renovate) [dep-alt]

## C12 — Testing, QA & accessibility → `12-testing-qa.md`
node:test runner + tsx [dep] · @testing-library/react + dom [dep] · jsdom/global-jsdom [dep] · @playwright/test [dep] · @axe-core/playwright [dep] · fast-check property [dep] · coverage (node --experimental-test-coverage/c8) [dep] · unit alt (Vitest/Jest) [dep-alt] · e2e alt (Cypress) [dep-alt] · a11y alt (pa11y) [dep-alt] · mocking (MSW) [new] · visual regression (Playwright/Chromatic/Loki) [new]

## C13 — CI/CD, lint, formatting & quality gates → `13-cicd-tooling.md`
eslint@9 + eslint-config-next + jsx-a11y + local rules [dep] · knip [dep] · jscpd [dep] · size-limit + @size-limit/file [dep] · @next/bundle-analyzer [dep] · react-scan [dep] · @lhci/cli [dep] · husky [dep] · @changesets/cli [dep] · style-dictionary [dep] · tsx [dep] · linter alt (Biome/Oxlint) [dep-alt] · formatter (Prettier/Biome) [dep-alt] · CI platform (GitHub Actions vs GitLab/Buildkite/Dagger) [new] · release alt (semantic-release) [dep-alt] · git-hooks alt (lefthook) [dep-alt] · dead-code alt (ts-prune) [dep-alt]

## C14 — Runtime services: cache, rate-limit, queue, email, realtime, files, export → `14-runtime-services.md`
nodemailer email [dep] · in-memory rate-limit [dep] · exceljs export [dep] · @tanstack/react-query client cache [dep] · distributed cache/rate-limit (Redis/Valkey/Upstash/@upstash/ratelimit) [new] · queue/jobs (BullMQ/pg-boss/Inngest/Trigger.dev/Temporal) [new] · email alt (Resend/Postmark/SES + React-Email) [dep-alt] · realtime (Pusher/Ably/Soketi/Centrifugo/SSE) [new] · file uploads (Vercel-Blob/UploadThing/S3-presigned/tus) [new] · export alt (PDF: react-pdf/puppeteer; Excel: sheetjs) [dep-alt]

## C15 — Enterprise-tool architects (AI era) → `15-architects-ai-era.md`
Top-10 architects/thinkers/orgs for building enterprise app platforms + how the AI era changes the play → concrete tweaks to OUR harness / role-agent model. (See its dedicated agent prompt.)

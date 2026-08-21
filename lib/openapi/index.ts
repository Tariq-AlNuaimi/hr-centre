// Barrel for the OpenAPI contract-seam generation layer (ADR-052).
// Pure functions over the existing lib/validations zod schemas -- no I/O.
export { buildOpenApiDocument, buildOpenApiDocumentSafe } from "./document";
/** @public */
export {
  BEARER_SCHEME_NAME,
  buildPaths,
  registeredRoutes,
  type RegisteredMethod,
  type RegisteredResponse,
  type RegisteredRoute,
} from "./registry";

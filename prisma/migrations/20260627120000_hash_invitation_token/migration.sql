-- Invitation token hash-at-rest (SECURITY.md §1; Phase-5 prerequisite, findings
-- register 2026-06-27). Rename invitations.token -> tokenHash: the column now
-- stores HMAC-SHA256(rawToken, TOKEN_HMAC_KEY) (lib/token.ts), never the raw
-- token. Pre-launch, so no real candidate links have been issued; the rename
-- keeps the column and its unique index intact, and the candidate runner is
-- updated in the same change to resolve a candidate by tokenHash.
ALTER TABLE "invitations" RENAME COLUMN "token" TO "tokenHash";
ALTER INDEX "invitations_token_key" RENAME TO "invitations_tokenHash_key";

#!/bin/sh
# Encrypted off-host backup of Postgres + MinIO.
#
# Invoked by /etc/crontabs/root in the backup sidecar (deploy/backup-entrypoint.sh).
# Vendor-agnostic: the operator configures rclone with whichever S3-compatible target
# they prefer (DO Spaces / B2 / Wasabi / R2 / AWS S3) and the script just hands off
# encrypted blobs to that remote.
#
# Required env (passed via docker-compose.prod.yml `backup` service):
#   POSTGRES_HOST       (default: next-template-db)
#   POSTGRES_USER       (default: app)
#   POSTGRES_DB         (default: app_db)
#   POSTGRES_PASSWORD   (Restricted -- from .env on host)
#   RCLONE_REMOTE       e.g. "spaces", "b2", "r2" -- name configured in rclone.conf
#   BACKUP_BUCKET       bucket / container name at the remote
#
# Required files (mounted into the sidecar):
#   /etc/backup/recipient            age public key (single line, AGE1...)
#   /root/.config/rclone/rclone.conf rclone configuration
#
# Retention: 30d on host, 90d off-host.

set -eu

TS=$(date -u +%Y%m%dT%H%M%SZ)
BACKUPS_DIR=/var/backups
DB_BACKUP="${BACKUPS_DIR}/${TS}.db.dump.age"
MINIO_BACKUP="${BACKUPS_DIR}/${TS}.minio.tar.age"

log() { echo "[backup $(date -u +%FT%TZ)] $*"; }
fail() { echo "[backup $(date -u +%FT%TZ)] ERROR: $*" >&2; exit 1; }

mkdir -p "${BACKUPS_DIR}"

# Preflight
[ -f /etc/backup/recipient ] || fail "/etc/backup/recipient (age public key) missing"
[ -f /root/.config/rclone/rclone.conf ] || fail "rclone config missing at /root/.config/rclone/rclone.conf"
[ -n "${RCLONE_REMOTE:-}" ] || fail "RCLONE_REMOTE env var unset"
[ -n "${BACKUP_BUCKET:-}" ] || fail "BACKUP_BUCKET env var unset"
[ -n "${POSTGRES_PASSWORD:-}" ] || fail "POSTGRES_PASSWORD env var unset"

RECIPIENT=$(cat /etc/backup/recipient)

log "start ${TS}"

# 1. Postgres dump (custom format, encrypted)
log "pg_dump -> age..."
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  -h "${POSTGRES_HOST:-next-template-db}" \
  -U "${POSTGRES_USER:-app}" \
  -d "${POSTGRES_DB:-app_db}" \
  --format=custom \
  | age -r "${RECIPIENT}" -o "${DB_BACKUP}"
log "db backup -> $(du -h "${DB_BACKUP}" | cut -f1)"

# 2. MinIO data (tar, encrypted) -- skipped if the bind mount is absent so the script
# still works in environments where MinIO is not in scope.
if [ -d /var/lib/miniodata ]; then
  log "tar miniodata -> age..."
  tar -C /var/lib/miniodata -cf - . | age -r "${RECIPIENT}" -o "${MINIO_BACKUP}"
  log "minio backup -> $(du -h "${MINIO_BACKUP}" | cut -f1)"
else
  log "skipping minio backup (no /var/lib/miniodata mount)"
fi

# 3. Off-host copy
log "rclone copy to ${RCLONE_REMOTE}:${BACKUP_BUCKET}/..."
rclone copy "${DB_BACKUP}" "${RCLONE_REMOTE}:${BACKUP_BUCKET}/"
[ -f "${MINIO_BACKUP}" ] && rclone copy "${MINIO_BACKUP}" "${RCLONE_REMOTE}:${BACKUP_BUCKET}/"

# 4. On-host retention: 30d
log "local retention sweep (30d)..."
find "${BACKUPS_DIR}" -name '*.age' -mtime +30 -delete

# 5. Off-host retention: 90d. `|| true` because rclone delete --min-age may exit
# non-zero if no files match, which we don't want to fail the whole run on.
log "remote retention sweep (90d)..."
rclone delete --min-age 90d "${RCLONE_REMOTE}:${BACKUP_BUCKET}/" --include '*.age' || true

log "complete ${TS}"

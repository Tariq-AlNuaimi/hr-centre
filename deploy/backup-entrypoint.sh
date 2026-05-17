#!/bin/sh
# Backup sidecar bootstrap.
#
# Runs once on container start. Installs deps, writes the crontab, then
# execs `crond -f` so the container stays alive.
#
# Gated by BACKUP_ENABLED -- the template defaults to disabled so a fresh
# fork doesn't error-loop every night before rclone + age are configured.
# The first-fork bootstrap skill flips BACKUP_ENABLED=true after the
# operator generates the age keypair and configures rclone.

if [ "${BACKUP_ENABLED:-false}" != "true" ]; then
  echo "[backup-sidecar] BACKUP_ENABLED is not 'true' -- idling."
  echo "  To enable: generate an age keypair, configure rclone, set BACKUP_ENABLED=true."
  echo "  See: /.claude/skills/first-fork (D3.2 + D3.3)."
  exec sleep infinity
fi

set -e

echo "[backup-sidecar] installing deps..."
apk add --no-cache postgresql-client age rclone tini >/dev/null

echo "[backup-sidecar] writing crontab (nightly 02:00 UTC)..."
cat > /etc/crontabs/root <<'EOF'
0 2 * * * /scripts/backup.sh >> /proc/1/fd/1 2>> /proc/1/fd/2
EOF

echo "[backup-sidecar] booted; next run = next 02:00 UTC"
exec crond -f

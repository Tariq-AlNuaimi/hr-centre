// scripts/lib/secrets.mjs
//
// Secret-material generators. Mirrors the `openssl rand -base64 N` outputs the
// existing /first-fork checklist asks for, so a deploy run produces the same
// shape of value the operator would have pasted by hand.

import { randomBytes } from 'node:crypto';

export function randB64(bytes) {
  return randomBytes(bytes).toString('base64');
}

export function randHex(bytes) {
  return randomBytes(bytes).toString('hex');
}

// `openssl rand -base64 32` shape -- for AUTH_SECRET.
export function authSecret() {
  return randB64(32);
}

// `openssl rand -base64 24` shape -- for POSTGRES_PASSWORD.
export function dbPassword() {
  return randB64(24);
}

// `openssl rand -base64 48` shape -- for AUDIT_PURGE_TOKEN.
export function auditToken() {
  return randB64(48);
}

// MinIO scoped credentials. Access key is hex; secret key is base64.
export function minioAccessKey() {
  return randHex(10);
}
export function minioSecretKey() {
  return randB64(32);
}

// First-time admin seed (operator rotates on first login).
export function seedPassword() {
  return randB64(18);
}

// age keypair for backups. `age-keygen` produces lines like:
//   # public key: age1abc...
//   AGE-SECRET-KEY-1...
// We synthesize the same shape via libsodium's X25519 keypair (which is what
// age uses under the hood). Returns { recipient, identity }.
//
// Lazy-imported so dry-run smoke tests don't require the dep to be installed.
export async function ageKeyPair() {
  // Bech32 encoding is age's wire format. We avoid pulling a bech32 dep by
  // delegating to the `age-keygen` binary if it's on PATH; otherwise we punt
  // and require the operator to provide one (printed as an error). The deploy
  // skill walks them through it.
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('age-keygen', [], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      'age-keygen not on PATH. Install via `apt install age` or `brew install age`, ' +
      'or set BACKUP_AGE_IDENTITY + BACKUP_AGE_RECIPIENT manually before re-running deploy.'
    );
  }
  const lines = r.stdout.split('\n');
  const pub = lines.find(l => l.startsWith('# public key:'));
  const priv = lines.find(l => l.startsWith('AGE-SECRET-KEY-1'));
  if (!pub || !priv) {
    throw new Error(`age-keygen output unexpected:\n${r.stdout}`);
  }
  return {
    recipient: pub.replace(/^# public key:\s*/, '').trim(),
    identity: priv.trim(),
  };
}

// SSH keypair for ops user on the droplet. We accept the operator's pubkey via
// --ssh-pubkey rather than generating one (private key should never leave the
// operator's machine in this pipeline).
export function validateSshPubkey(s) {
  return /^(ssh-(rsa|ed25519)|ecdsa-sha2-)\s+[A-Za-z0-9+/=]+(\s+\S+)?$/.test(s.trim());
}

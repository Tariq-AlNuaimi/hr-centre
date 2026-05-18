// scripts/lib/log.mjs
//
// Tiny logging helpers shared across the deploy/provision scripts.
// Prefix lines so the operator can tell who-said-what across nested calls.

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';

function tty() {
  return process.stdout.isTTY === true;
}

function paint(color, s) {
  return tty() ? `${color}${s}${RESET}` : s;
}

export function info(prefix, msg) {
  console.log(`${paint(CYAN, `[${prefix}]`)} ${msg}`);
}

export function step(prefix, msg) {
  console.log(`${paint(BLUE, `[${prefix}]`)} ${paint(BOLD, '→')} ${msg}`);
}

export function ok(prefix, msg) {
  console.log(`${paint(GREEN, `[${prefix}]`)} ${paint(GREEN, '✓')} ${msg}`);
}

export function warn(prefix, msg) {
  console.log(`${paint(YELLOW, `[${prefix}]`)} ${paint(YELLOW, '!')} ${msg}`);
}

export function err(prefix, msg) {
  console.error(`${paint(RED, `[${prefix}]`)} ${paint(RED, '✗')} ${msg}`);
}

export function dim(prefix, msg) {
  console.log(`${paint(DIM, `[${prefix}] ${msg}`)}`);
}

export function dryPrefix(isDry) {
  return isDry ? paint(YELLOW, '[DRY-RUN] ') : '';
}

export function bail(prefix, msg) {
  err(prefix, msg);
  process.exit(1);
}

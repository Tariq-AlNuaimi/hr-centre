/** Monthly buckets from go-live to the last activation, zero months emitted. */
export function monthBuckets(goLive: Date, last: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(goLive.getUTCFullYear(), goLive.getUTCMonth(), 1));
  const end = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1));
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

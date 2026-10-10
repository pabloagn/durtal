/** Sync cursors retain PostgreSQL microseconds; a JavaScript Date is not a cursor. */
const THOUSAND = BigInt(1000);
const MILLION = BigInt(1_000_000);
export const ANNOTATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function annotationTimeMicros(value: string): bigint {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match || match[1].startsWith("0000-"))
    throw new Error("Invalid annotation timestamp");
  const [, base, fraction = "", zone] = match;
  const local = new Date(`${base}Z`);
  if (
    !Number.isFinite(local.getTime()) ||
    local.toISOString().slice(0, 19) !== base
  )
    throw new Error("Invalid annotation timestamp");
  if (
    zone !== "Z" &&
    (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)
  )
    throw new Error("Invalid annotation timestamp offset");
  const seconds = Date.parse(base + zone);
  if (!Number.isFinite(seconds))
    throw new Error("Invalid annotation timestamp");
  return BigInt(seconds) * THOUSAND + BigInt(fraction.padEnd(6, "0"));
}

export function annotationTimeFromMicros(value: bigint): string {
  const whole =
    value >= BigInt(0)
      ? value / MILLION
      : (value - (MILLION - BigInt(1))) / MILLION;
  const seconds = Number(whole);
  const fraction = value - whole * MILLION;
  const base = new Date(seconds * 1000).toISOString().slice(0, 19);
  if (!/^\d{4}-/.test(base))
    throw new Error("Annotation timestamp outside supported range");
  return `${base}.${fraction.toString().padStart(6, "0")}Z`;
}

export const canonicalAnnotationTime = (value: string) =>
  annotationTimeFromMicros(annotationTimeMicros(value));
export function compareAnnotationTimes(a: string, b: string): -1 | 0 | 1 {
  const left = annotationTimeMicros(a),
    right = annotationTimeMicros(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The server must call this under its per-book transaction lock. */
export function nextAnnotationServerTime(
  previous: string | null,
  observed: string,
): string {
  const wall = annotationTimeMicros(observed);
  const next =
    previous === null ? wall : annotationTimeMicros(previous) + BigInt(1);
  return annotationTimeFromMicros(wall > next ? wall : next);
}

/** Inclusive lower bounds permit safe overlap; the client deduplicates by id/version. */
export function annotationPullWindow(since: string | null, serverTime: string) {
  const upper = canonicalAnnotationTime(serverTime);
  if (since === null) return { reset: true, since: null, serverTime: upper };
  const lower = canonicalAnnotationTime(since);
  const age = annotationTimeMicros(upper) - annotationTimeMicros(lower);
  if (age < BigInt(0))
    throw new Error("Annotation cursor is ahead of the server");
  const reset = age >= BigInt(ANNOTATION_RETENTION_MS) * THOUSAND;
  return { reset, since: reset ? null : lower, serverTime: upper };
}

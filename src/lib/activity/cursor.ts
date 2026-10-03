/**
 * Keyset cursor for the activity timeline: `(created_at, id)`.
 *
 * `createdAt` is the database's own text form of the timestamp, so it keeps
 * microsecond precision (a JS Date would cut it to milliseconds). The `id`
 * breaks ties between events that share a timestamp.
 */
export interface ActivityCursor {
  createdAt: string;
  id: string;
}

const SEPARATOR = "|";

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return `${cursor.createdAt}${SEPARATOR}${cursor.id}`;
}

export function decodeActivityCursor(value: string): ActivityCursor | null {
  const i = value.lastIndexOf(SEPARATOR);
  if (i <= 0 || i === value.length - 1) return null;
  return { createdAt: value.slice(0, i), id: value.slice(i + 1) };
}

/*
 * What a book delete takes with it, in words (SLN-444): editions, copies,
 * the reading history and its quotes and notes (SLN-453), which nothing
 * restores.
 */

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "a, b and c" */
function listed(parts: string[]) {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * "This will also delete 2 editions, 1 instance, 3 readings (41 sessions),
 * 12 quotes and 2 notes." Parts with none are left out; undefined when
 * nothing else goes.
 */
export function workDeleteCascadeMessage({
  editions,
  instances,
  readings,
  sessions,
  quotes = 0,
  notes = 0,
}: {
  editions: number;
  instances: number;
  readings: number;
  sessions: number;
  quotes?: number;
  notes?: number;
}): string | undefined {
  const parts: string[] = [];
  if (editions > 0) parts.push(count(editions, "edition", "editions"));
  if (instances > 0) parts.push(count(instances, "instance", "instances"));
  if (readings > 0)
    parts.push(`${count(readings, "reading", "readings")}${sessions > 0 ? ` (${count(sessions, "session", "sessions")})` : ""}`);
  if (quotes > 0) parts.push(count(quotes, "quote", "quotes"));
  if (notes > 0) parts.push(count(notes, "note", "notes"));
  return parts.length ? `This will also delete ${listed(parts)}.` : undefined;
}

/** The bulk delete dialog's warning */
export const BULK_DELETE_CASCADE =
  "This will permanently delete all editions, instances, and media associated with the selected works, and their reading history, quotes and notes.";

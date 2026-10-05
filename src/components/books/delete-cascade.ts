/*
 * What a book delete takes with it, in words (SLN-444): editions, copies and
 * the reading history, which nothing restores.
 */

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "a, b and c" */
function listed(parts: string[]) {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * "This will also delete 2 editions, 1 instance and 3 readings (41
 * sessions)." Parts with none are left out; undefined when nothing else goes.
 */
export function workDeleteCascadeMessage({
  editions,
  instances,
  readings,
  sessions,
}: {
  editions: number;
  instances: number;
  readings: number;
  sessions: number;
}): string | undefined {
  const parts: string[] = [];
  if (editions > 0) parts.push(count(editions, "edition", "editions"));
  if (instances > 0) parts.push(count(instances, "instance", "instances"));
  if (readings > 0)
    parts.push(`${count(readings, "reading", "readings")}${sessions > 0 ? ` (${count(sessions, "session", "sessions")})` : ""}`);
  return parts.length ? `This will also delete ${listed(parts)}.` : undefined;
}

/** The bulk delete dialog's warning */
export const BULK_DELETE_CASCADE =
  "This will permanently delete all editions, instances, and media associated with the selected works, and their reading history.";

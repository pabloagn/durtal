/**
 * Database rule errors reach actions wrapped by the ORM ("Failed query: ..."),
 * with the PostgreSQL error as the cause. Messages raised by our own triggers
 * and assertions are written for people, including those raised with a
 * constraint code; PostgreSQL's built-in constraint messages get a plain one.
 * SQL and parameters are never shown. The original error stays attached as the
 * cause.
 */
interface DatabaseCause {
  code: string;
  message: string;
}
function databaseCause(error: unknown): DatabaseCause | null {
  let current = error as { code?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code))
      return current as DatabaseCause;
    current = current.cause as typeof current;
  }
  return null;
}
export interface DatabaseMessages {
  /** A unique constraint rejected the write. */
  unique?: string;
  /** A foreign key rejected the write. */
  reference?: string;
}
/** PostgreSQL's own constraint wording, as opposed to a message a rule raised. */
const BUILT_IN =
  /violates (unique|foreign key|check) constraint|^duplicate key value|^new row for relation/;
export function readableDatabaseError(
  error: unknown,
  messages: DatabaseMessages = {},
): unknown {
  const cause = databaseCause(error);
  const raised =
    cause?.code === "P0001" ||
    (!!cause &&
      ["23505", "23503", "23514"].includes(cause.code) &&
      !BUILT_IN.test(cause.message));
  const message = raised
    ? cause!.message
    : cause?.code === "23505"
        ? (messages.unique ?? "This would duplicate an existing record")
        : cause?.code === "23503"
          ? (messages.reference ??
            "Another record still uses this, or a linked record no longer exists")
          : cause?.code === "23514"
            ? "A value breaks a catalogue rule"
            : null;
  return message ? new Error(message, { cause: error }) : error;
}
export async function withReadableErrors<T>(
  run: () => Promise<T>,
  messages?: DatabaseMessages,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw readableDatabaseError(error, messages);
  }
}

/*
 * What a book or copy delete takes with it, in words (SLN-444): editions,
 * copies, the reading history and its quotes and notes (SLN-453), orders
 * with their status history, acquisition targets and images (SLN-1112),
 * which nothing restores. One message for the card menu, the book page and
 * bulk delete.
 */

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** "a, b and c" */
function listed(parts: string[]) {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** What goes with one book or a selection of them, counted on the server */
export interface WorkDeleteCounts {
  editions: number;
  copies: number;
  readings: number;
  sessions: number;
  quotes?: number;
  notes?: number;
  orders?: number;
  targets?: number;
  images?: number;
  /** Linked eBooks, which return to review */
  ebooks?: number;
}

/**
 * "This will also delete 2 editions, 1 copy, 3 readings (41 sessions),
 * 12 quotes, 2 notes, 1 order with its status history, 1 acquisition target
 * and 3 images." Parts with none are left out; then what happens to linked
 * eBooks, when there are any. Undefined when nothing else is touched.
 */
export function workDeleteCascadeMessage({
  editions,
  copies,
  readings,
  sessions,
  quotes = 0,
  notes = 0,
  orders = 0,
  targets = 0,
  images = 0,
  ebooks = 0,
}: WorkDeleteCounts): string | undefined {
  const parts: string[] = [];
  if (editions > 0) parts.push(count(editions, "edition", "editions"));
  if (copies > 0) parts.push(count(copies, "copy", "copies"));
  if (readings > 0)
    parts.push(`${count(readings, "reading", "readings")}${sessions > 0 ? ` (${count(sessions, "session", "sessions")})` : ""}`);
  if (quotes > 0) parts.push(count(quotes, "quote", "quotes"));
  if (notes > 0) parts.push(count(notes, "note", "notes"));
  if (orders > 0) parts.push(`${count(orders, "order", "orders")} with ${orders === 1 ? "its" : "their"} status history`);
  if (targets > 0) parts.push(count(targets, "acquisition target", "acquisition targets"));
  if (images > 0) parts.push(count(images, "image", "images"));
  const sentences = [
    parts.length ? `This will also delete ${listed(parts)}.` : null,
    ebooks === 1
      ? "The linked eBook returns to review; its files, reading positions and annotations are kept."
      : ebooks > 1
        ? `The ${count(ebooks, "linked eBook", "linked eBooks")} return to review; their files, reading positions and annotations are kept.`
        : null,
  ].filter(Boolean);
  return sentences.length ? sentences.join(" ") : undefined;
}

/** While the counts load */
export const DELETE_CASCADE_COUNTING = "Counting what goes with it…";

/** When the counts could not be read: every kind of record that goes, uncounted */
export function workDeleteFallback(many: boolean) {
  return many
    ? "This will also delete the selected books' editions, copies, images, reading history, quotes, notes, orders and acquisition targets. Linked eBooks return to review."
    : "This will also delete the book's editions, copies, images, reading history, quotes, notes, orders and acquisition targets. Linked eBooks return to review.";
}

/** The dialog's warning for the counts as they stand: loading, unread or read */
export function workDeleteCascade(counts: WorkDeleteCounts | null | undefined, many = false): string | undefined {
  if (counts === undefined) return DELETE_CASCADE_COUNTING;
  if (counts === null) return workDeleteFallback(many);
  return workDeleteCascadeMessage(counts);
}

/** What goes with one copy, and what stays */
export interface CopyDeleteCounts {
  /** Rows of its status history */
  history: number;
  /** Acquisition targets it was marked as fulfilling */
  targets: number;
  /** Readings and orders that name it: they stay, without the copy */
  readings: number;
  orders: number;
  ebook: boolean;
}

/**
 * "This will also delete its status history and its link to 1 acquisition
 * target. Its eBook returns to review; its files, reading positions and
 * annotations are kept. 2 readings and 1 order stay with the book, without
 * this copy." Undefined when nothing else is touched.
 */
export function copyDeleteCascadeMessage({ history, targets, readings, orders, ebook }: CopyDeleteCounts): string | undefined {
  const gone = [
    ...(history > 0 ? ["its status history"] : []),
    ...(targets > 0 ? [`its link to ${count(targets, "acquisition target", "acquisition targets")}`] : []),
  ];
  const kept = [
    ...(readings > 0 ? [count(readings, "reading", "readings")] : []),
    ...(orders > 0 ? [count(orders, "order", "orders")] : []),
  ];
  const sentences = [
    gone.length ? `This will also delete ${listed(gone)}.` : null,
    ebook ? "Its eBook returns to review; its files, reading positions and annotations are kept." : null,
    kept.length ? `${listed(kept)} ${readings + orders === 1 ? "stays" : "stay"} with the book, without this copy.` : null,
  ].filter(Boolean);
  return sentences.length ? sentences.join(" ") : undefined;
}

/**
 * Why a book can't be deleted: an order with the book in hand is its
 * acquisition record, which an order delete refuses too (SLN-1112).
 */
export function keptOrderRefusal({
  title,
  status,
  venue,
  date,
}: {
  title: string;
  /** The status's label: "Delivered" */
  status: string;
  venue: string | null;
  /** The order date, written out */
  date: string | null;
}): string {
  const about = [venue ? `from ${venue}` : null, date].filter(Boolean).join(", ");
  return `"${title}" has an order marked ${status}${about ? ` (${about})` : ""}, which is its acquisition record. Mark the order Returned before deleting the book.`;
}

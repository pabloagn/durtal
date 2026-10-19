import { z } from "zod/v4";

/**
 * Why one upload's check failed, in words its row can show (SLN-1388). A
 * failure whose inspector exit and cleanup are proved fails only that item;
 * the service stays ready for the next one.
 */
export const uploadJobFailureSchema = z.strictObject({
  reason: z.enum(["not_an_ebook", "check_failed"]),
  /** What the file is instead, as the sniffer names it ("PNG image") */
  what: z.string().regex(/^[A-Za-z0-9 ]{1,40}$/).nullable(),
});
export type UploadJobFailure = z.infer<typeof uploadJobFailureSchema>;

/** "PNG image" from the sniffer's "Not an e-book (PNG image)"; "empty file" from "Empty file" */
export function notEbookWhat(sniffReason: string): string | null {
  const named = /^Not an e-book \(([A-Za-z0-9 ]{1,40})\)$/.exec(sniffReason)?.[1];
  return named ?? (sniffReason === "Empty file" ? "empty file" : null);
}

export function notEbookMessage(what: string | null): string {
  return what ? `Not added: not an e-book (${what}).` : "Not added: not an e-book.";
}

export function uploadJobFailureMessage(failure: UploadJobFailure): string {
  return failure.reason === "not_an_ebook" ? notEbookMessage(failure.what)
    : "Not added: the file couldn't be checked. Try again, or cancel it.";
}

/** The worker read the file and refused it: trying again gives the same answer */
export class UploadItemRefusal extends Error {
  readonly failure: UploadJobFailure;
  constructor(what: string | null) {
    super(notEbookMessage(what)); this.name = "UploadItemRefusal";
    this.failure = uploadJobFailureSchema.parse({ reason: "not_an_ebook", what });
  }
}

/** One item failed and was recorded; its inspector exit and cleanup were proved */
export class UploadItemFailed extends Error {
  constructor(readonly failure: UploadJobFailure, options: { cause: unknown }) {
    super(uploadJobFailureMessage(failure), options); this.name = "UploadItemFailed";
  }
}

export function uploadJobFailureOf(error: unknown): UploadJobFailure {
  for (let at = error, depth = 0; at instanceof Error && depth < 8; at = at.cause, depth++)
    if (at instanceof UploadItemRefusal) return at.failure;
  return { reason: "check_failed", what: null };
}

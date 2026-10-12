import type { UndoEntry } from "../ingest/register";
// The actual canonical495 registry owns capability/issuer types. No substitute
// writer, private brand or fallback is declared by the upload adapter.
export type { UploadAtomicBinding, UploadAtomicQueries, PreparedUploadAtomicExtension } from "../upload/atomic-extension";

/** Native registration data is evidence, never authorization for the CLI undo
 * path. Upload restoration uses the canonical guarded registration writer. */
export interface UploadOriginalEffect {
  readonly commandId: string;
  readonly key: string;
  readonly requestSha256: string;
  readonly effectSha256: string;
  readonly afterTargetSha256: string;
  readonly afterReaderSha256: string;
  readonly undo: UndoEntry;
}

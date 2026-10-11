import "server-only";
import { issueUploadAtomicExtensionInternal, type UploadAtomicBinding, type UploadAtomicQueries, type PreparedUploadAtomicExtension } from "./atomic-extension-registry";
/** Actual496 upload/store issuer only. Browser transport never receives the
 * binding/query builders or the capability; it receives a preview token. */
export function prepareUploadAtomicExtension(binding: UploadAtomicBinding, queries: UploadAtomicQueries): PreparedUploadAtomicExtension {
  return issueUploadAtomicExtensionInternal(binding, queries);
}
export type { UploadAtomicBinding, UploadAtomicQueries, PreparedUploadAtomicExtension } from "./atomic-extension-registry";

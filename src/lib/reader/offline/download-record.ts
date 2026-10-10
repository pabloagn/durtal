import type { DownloadIdentity } from "./download-policy";
export interface DownloadRecord {
  v: 1;
  key: string;
  identity: DownloadIdentity;
  book: { title: string; authors: string[] };
  deviceId: string;
  state: "downloading" | "ready" | "failed";
  token: string;
  leaseUntil: number | null;
  downloadedAt: string | null;
  failure: string | null;
}
export function downloadKey(identity: DownloadIdentity): string {
  return `${identity.fileId.toLowerCase()}:${identity.sha256}`;
}
/** Only virtual unsigned keys are stored; transient signed delivery URLs never are. */
export function bookCacheUrl(identity: DownloadIdentity, origin: string): string {
  return new URL(`/__durtal_books/${identity.fileId.toLowerCase()}/${identity.sha256}`, origin).href;
}

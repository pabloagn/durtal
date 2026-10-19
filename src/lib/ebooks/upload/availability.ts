/** Where `installUploadBroker` puts the one broker of this server process. */
export const UPLOAD_BROKER_KEY = Symbol.for("durtal.ebook-upload.broker.v1");

/** Whether this server process can take uploads, so the upload page can say so before any file is chosen (SLN-672). */
export function uploadsAvailable(): boolean {
  return !!(globalThis as unknown as Record<symbol, unknown>)[UPLOAD_BROKER_KEY];
}

/** What the installed broker says up front about refusing uploads now, such as an AWS sign-in to renew (SLN-1326) */
export async function uploadsNotice(): Promise<string | null> {
  const broker = (globalThis as unknown as Record<symbol, { notice?: () => Promise<string | null> } | undefined>)[UPLOAD_BROKER_KEY];
  return broker?.notice ? broker.notice().catch(() => null) : null;
}

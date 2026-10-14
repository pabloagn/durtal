/** Where `installUploadBroker` puts the one broker of this server process. */
export const UPLOAD_BROKER_KEY = Symbol.for("durtal.ebook-upload.broker.v1");

/** Whether this server process can take uploads, so the upload page can say so before any file is chosen (SLN-672). */
export function uploadsAvailable(): boolean {
  return !!(globalThis as unknown as Record<symbol, unknown>)[UPLOAD_BROKER_KEY];
}

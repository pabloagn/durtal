/**
 * The files a comment may carry, by extension, with the type each is stored
 * and served as. The type comes from this list, never from the browser, and
 * anything else is refused: programs and scripts (.exe, .sh, .bat, .app,
 * .dmg, .jar, .ps1 ...) are not on it. /api/s3/read serves every type but
 * raster images as a download (read-headers.ts).
 */
const ATTACHMENT_TYPES: Record<string, string> = {
  // Images
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  rtf: "application/rtf",
  epub: "application/epub+zip",
  // Text and code: stored as plain text
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "text/plain",
  yaml: "text/plain",
  yml: "text/plain",
  py: "text/plain",
  ts: "text/plain",
  tsx: "text/plain",
  js: "text/plain",
  jsx: "text/plain",
  css: "text/plain",
  html: "text/plain",
  sql: "text/plain",
  // Archives
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
};

/** The extension and stored type of an attachment's file name, or null when it is not allowed. */
export function attachmentType(fileName: string): { ext: string; mimeType: string } | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 1) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  const mimeType = Object.hasOwn(ATTACHMENT_TYPES, ext) ? ATTACHMENT_TYPES[ext] : undefined;
  return mimeType ? { ext, mimeType } : null;
}

/** For the refusal message: the extensions a comment accepts. */
export const ATTACHMENT_EXTENSIONS = Object.keys(ATTACHMENT_TYPES);

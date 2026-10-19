import { sniffFormat, SNIFF_HEAD_BYTES } from "../ingest/sniff";
import { notEbookWhat } from "./job-failure";

const ZIP = [0x50, 0x4b, 0x03, 0x04];

/**
 * Why a chosen file is plainly not an e-book, read from its first bytes with
 * the server's own rules, so it is refused before it is sent (SLN-1388). Null
 * when it may be one: a zip's entries sit at its end, so the server decides.
 */
export async function browserUploadRefusal(file: Blob & { name: string }): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, SNIFF_HEAD_BYTES).arrayBuffer());
  if (!head.length || ZIP.every((byte, at) => head[at] === byte)) return null;
  const sniffed = sniffFormat(head, file.name);
  if (sniffed.kind === "ebook") return null;
  const what = notEbookWhat(sniffed.reason);
  return `Not added: ${file.name} is not an e-book${what ? ` (${what})` : ""}.`;
}

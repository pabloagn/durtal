import type { EbookFormat } from "../../formats";
import { formatLabel } from "../../formats";
import type { ByteSource } from "../source";
import { MAX_ENTRY_BYTES } from "../zip";
import { inspectCbz } from "./cbz";
import { inspectEpub } from "./epub";
import { inspectFb2 } from "./fb2";
import { inspectMobi } from "./mobi";
import { inspectPdf } from "./pdf";
import { emptyInspection, type Inspection } from "./types";

/*
 * One file's inspection by its sniffed format (SLN-494). Formats the reader
 * cannot open are stored as they are: no metadata, cover or text is read
 * from them, and the file name gives the title.
 */

export async function inspectFile(source: ByteSource, format: EbookFormat): Promise<Inspection> {
  const head = await source.read(0, 8);
  const magic = String.fromCharCode(...head);
  switch (format) {
    case "epub":
    case "kepub":
      return inspectEpub(source, format);
    case "mobi":
    case "azw":
    case "azw3":
      if (magic.startsWith("TPZ")) return emptyInspection(format, {
          details: { unverified: true, nativeReadable: false },
          text: { kind: "none", reason: "Topaz integrity and DRM are not verified" },
        });
      return inspectMobi(source, format);
    case "pdf":
      return inspectPdf(source);
    case "cbz":
      return inspectCbz(source);
    case "fb2":
    case "fbz":
      return inspectFb2(source, format);
    case "kfx":
      // A DRMION wrapper is Kindle's DRM
      if (magic === "\xEADRMION") return emptyInspection(format, { drm: "kindle" });
      return emptyInspection(format, { text: { kind: "none", reason: "KFX: its text is not read" } });
    case "txt": {
      if (source.size > MAX_ENTRY_BYTES) return emptyInspection(format, { text: { kind: "none", reason: "Text file larger than 64 MB: not counted" } });
      const text = new TextDecoder("utf-8").decode(await source.read(0, source.size));
      return emptyInspection(format, { text: { kind: "plain", text } });
    }
    default:
      return emptyInspection(format, { text: { kind: "none", reason: `${formatLabel(format)}: its text is not read` } });
  }
}

export type { Inspection } from "./types";

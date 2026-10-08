import type { EbookFormat } from "../formats";
import type { ManifestFacts } from "./inspect/types";

/*
 * `manifest.json` beside a file's covers (SLN-494): what the reader needs
 * before its first range request. `zip.cdOffset` lets it read an EPUB's or
 * comic's central directory in one request.
 */

export interface EbookManifest extends ManifestFacts {
  v: 1;
  sha256: string;
  format: EbookFormat;
  size: number;
}

export function makeManifest(file: { sha256: string; format: EbookFormat; size: number }, facts: ManifestFacts): EbookManifest {
  return {
    v: 1,
    sha256: file.sha256,
    format: file.format,
    size: file.size,
    ...(facts.zip ? { zip: facts.zip } : {}),
    ...(facts.pdf ? { pdf: facts.pdf } : {}),
    ...(facts.epub ? { epub: facts.epub } : {}),
  };
}

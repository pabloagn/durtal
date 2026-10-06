import { createHash } from "node:crypto";

/**
 * A text fingerprint for syndication (R6, SLN-468): a MinHash signature of
 * 128 values over word 5-shingles. Two copies of one syndicated review share
 * most shingles; two reviews of one book share few. The stored text is not
 * changed: case folding and punctuation removal apply to the fingerprint only.
 */

const VALUES = 128;
const SHINGLE = 5;
export const FINGERPRINT_METHOD = `minhash-${VALUES}-w${SHINGLE}-sha256-km32`;
/** Estimated Jaccard similarity from which two texts count as one */
export const SAME_TEXT_THRESHOLD = 0.5;

export interface Fingerprint {
  method: string;
  values: number[];
}

function shingles(text: string): string[] {
  const words = text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= SHINGLE) return [words.join(" ")];
  return Array.from({ length: words.length - SHINGLE + 1 }, (_, i) => words.slice(i, i + SHINGLE).join(" "));
}

export function fingerprint(text: string): Fingerprint {
  const values = new Array<number>(VALUES).fill(0xffffffff);
  for (const shingle of new Set(shingles(text))) {
    const digest = createHash("sha256").update(shingle).digest();
    // Two 32-bit hashes give all 128: h1 + i * h2 (Kirsch and Mitzenmacher)
    const h1 = digest.readUInt32BE(0);
    const h2 = digest.readUInt32BE(4);
    for (let i = 0; i < VALUES; i++) {
      const value = (h1 + Math.imul(i, h2)) >>> 0;
      if (value < values[i]) values[i] = value;
    }
  }
  return { method: FINGERPRINT_METHOD, values };
}

/** The estimated Jaccard similarity of two fingerprints, and whether they count as one text */
export function sameText(a: Fingerprint, b: Fingerprint): { similarity: number; same: boolean } {
  if (a.method !== b.method || a.values.length !== b.values.length) throw new Error("Fingerprints of different methods cannot be compared");
  const equal = a.values.filter((value, i) => value === b.values[i]).length;
  const similarity = equal / a.values.length;
  return { similarity, same: similarity >= SAME_TEXT_THRESHOLD };
}

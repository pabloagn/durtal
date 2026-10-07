import { attr, descendants, firstDescendant, parseXml } from "./xml";
import type { DrmKind } from "./types";

/*
 * DRM in an EPUB (SLN-494). `META-INF/encryption.xml` lists encrypted
 * entries. Font obfuscation (IDPF's and Adobe's) only hides embedded fonts
 * and is not DRM. Any other encrypted entry is: Adobe ADEPT with a
 * rights.xml, Readium LCP with a license.lcpl, Apple FairPlay with a
 * sinf.xml, else unknown. A DRM file is stored and listed with its kind,
 * never opened, stripped or converted.
 */

export const FONT_OBFUSCATION = new Set(["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"]);

/** The algorithms of encryption.xml, one per encrypted entry */
export function encryptionAlgorithms(encryptionXml: string): string[] {
  const doc = parseXml(encryptionXml);
  return descendants(doc, "encrypteddata").map((data) => attr(firstDescendant(data, "encryptionmethod"), "algorithm") ?? "");
}

/** The EPUB's DRM, or null when it has none (or only obfuscated fonts) */
export function epubDrm(names: readonly string[], encryptionXml: string | null): DrmKind | null {
  const has = (name: string) => names.some((n) => n.toLowerCase() === name.toLowerCase());
  const encrypted = encryptionXml ? encryptionAlgorithms(encryptionXml).filter((a) => !FONT_OBFUSCATION.has(a.trim())) : [];
  if (encrypted.length === 0) return null;
  if (has("META-INF/rights.xml")) return "adobe-adept";
  if (has("META-INF/license.lcpl")) return "readium-lcp";
  if (has("META-INF/sinf.xml")) return "apple-fairplay";
  return "unknown";
}

import type { ExtractedPage, MainTextExtractor } from "./evidence-store";

/**
 * The main-text extractor of the evidence store (SLN-468). Every caller goes
 * through `extractMainText`. Pending Pablo's yes to its two packages (a
 * readability-style extractor and a DOM implementation), it refuses.
 */
export function extractMainText(_html: string, _url: string): ExtractedPage | null {
  throw new Error("The main-text extractor is not installed yet: its packages wait for approval");
}

export const mainTextExtractor: MainTextExtractor = { name: "pending", version: "0", extract: extractMainText };

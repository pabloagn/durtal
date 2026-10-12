/** Complete pristine source facts, collected without live styles or font requests. */
export interface FontWindowFacts {
  complete: boolean;
  reasons: readonly string[];
  codepoints: readonly number[];
  languages: readonly string[];
}

export const UNKNOWN_FONT_FACTS: FontWindowFacts = Object.freeze({
  complete: false,
  reasons: Object.freeze(["typography-not-resolved"]),
  codepoints: Object.freeze([]),
  languages: Object.freeze([]),
});

export const FONT_PREFLIGHT_LIMITS = Object.freeze({ sections: 64, characters: 1_048_576 });

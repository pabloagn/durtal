/** Keep phone keyboards from rewriting names, search queries or identifiers. */
export const SEARCH_INPUT_ATTRIBUTES = {
  enterKeyHint: "search",
  autoCorrect: "off",
  autoCapitalize: "none",
  spellCheck: false,
} as const;

export const IDENTIFIER_INPUT_ATTRIBUTES = {
  autoCorrect: "off",
  autoCapitalize: "none",
  spellCheck: false,
} as const;

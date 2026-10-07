/*
 * The research agent's checked-in configuration (SLN-469). Pablo approves the
 * query table and the limits with the first plan; changing them is a PR.
 * The topic words name a subject ("prose"), never a term: a query such as
 * "Kaputt grotesque" would pick pages for the answer, and a test refuses a
 * topic word or a fixed word that equals or contains a current term's label
 * or key.
 */

export const RESEARCH_CONFIG = {
  /** Query group 1: title and author with "review", the original-language form, the translator */
  maxBaseQueries: 3,
  /** Query group 2: restricted to registry outlets, the original language's first */
  maxOutletQueries: 2,
  /** Query group 3: title and author with a research dimension's topic words */
  maxTopicQueries: 5,
  /** Results asked of a provider per query */
  resultsPerQuery: 10,
  /** Documents stored per outlet and per book */
  maxPerOutlet: 2,
  maxDocumentsPerWork: 10,
  /** US dollars a book may cost in a month, searches and extraction together (3 times the $0.50 estimate) */
  maxCostPerWork: 1.5,
} as const;

/** The word for "review" in each original language; a language without one gets title and author only */
export const REVIEW_WORDS: Record<string, string> = {
  en: "review",
  es: "reseña",
  fr: "critique",
  de: "Rezension",
  it: "recensione",
  pt: "resenha",
  ca: "ressenya",
  nl: "recensie",
  sv: "recension",
  da: "anmeldelse",
  no: "anmeldelse",
  pl: "recenzja",
  cs: "recenze",
  hu: "kritika",
  ro: "recenzie",
  ru: "рецензия",
  ja: "書評",
};

/**
 * The topic words of each research dimension, by its key in vocabulary v1
 * (SLN-461's draft): subjects reviews write about, never a term. Dimensions
 * with the same words share one query. A research dimension missing here gets
 * no topic query, and the plan says so.
 */
export const TOPIC_WORDS: Record<string, string> = {
  tone: "tone atmosphere",
  structure: "structure",
  content_warning: "content warnings",
  prose: "prose style",
  pace: "pacing",
  intensity: "intensity",
  narrative_pull: "plot suspense",
  form: "form",
  genre: "genre",
  speculative_level: "genre",
  literary_movement: "literary movement",
  themes: "themes",
  setting_period: "historical period",
};

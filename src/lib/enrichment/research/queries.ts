import type { Outlet } from "../outlets";
import { RESEARCH_CONFIG, REVIEW_WORDS, TOPIC_WORDS } from "./config";
import type { ResearchDimension, ResearchProfile } from "./profile";

/*
 * The research queries of one book (SLN-469, section 2), in three groups,
 * each with its own limit, so every group runs: base queries, queries
 * restricted to registry outlets, and topic queries.
 */

export type QueryGroup = "base" | "outlets" | "topics";

export interface ResearchQuery {
  group: QueryGroup;
  text: string;
  /** Outlet keys the query is restricted to, highest weight first; none for an open query */
  outlets: string[];
  /** The research dimensions a topic query is for */
  dimensions: string[];
}

export interface QueryPlan {
  queries: ResearchQuery[];
  /** Research dimensions with no topic words in the table */
  withoutTopic: string[];
}

const words = (...parts: (string | null | undefined)[]) => parts.filter((p): p is string => !!p?.trim()).join(" ");

/**
 * The queries of a book. `capacity` is how many outlets the main provider's
 * domain filter takes in one query.
 */
export function planQueries(profile: ResearchProfile, dimensions: ResearchDimension[], outlets: readonly Outlet[], capacity: number): QueryPlan {
  const title = profile.titles[0];
  const author = profile.authors[0].name;
  const language = profile.originalLanguage ?? "en";
  const foreign = language !== "en";
  // The original-language title: the work's original title when it has one, else its title
  const originalTitle = profile.originalTitle ?? title;

  // 1. Base: the English review query, the original language's, the translator's
  const base = [
    words(title, author, REVIEW_WORDS.en),
    ...(foreign ? [words(originalTitle, author, REVIEW_WORDS[language])] : []),
    ...(profile.translators.length ? [words(title, author, profile.translators[0].surname)] : []),
  ].slice(0, RESEARCH_CONFIG.maxBaseQueries);

  // 2. Outlets: the original language's outlets first when it is not English, then the rest by weight
  const eligible = outlets
    .filter((o) => o.status === "active" && (o.fetchPolicy === "fetch" || o.fetchPolicy === "snippet_only"))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  const inLanguage = foreign ? eligible.filter((o) => o.language === language) : [];
  const rest = eligible.filter((o) => !inLanguage.includes(o));
  const restricted: ResearchQuery[] = [];
  if (inLanguage.length)
    restricted.push({ group: "outlets", text: words(originalTitle, author, REVIEW_WORDS[language]), outlets: inLanguage.slice(0, capacity).map((o) => o.key), dimensions: [] });
  for (let i = 0; i < rest.length; i += capacity)
    restricted.push({ group: "outlets", text: words(title, author, REVIEW_WORDS.en), outlets: rest.slice(i, i + capacity).map((o) => o.key), dimensions: [] });

  // 3. Topics: dimensions with the same words share one query
  const topics = new Map<string, string[]>();
  const withoutTopic: string[] = [];
  for (const d of dimensions) {
    const topic = TOPIC_WORDS[d.key];
    if (!topic) withoutTopic.push(d.key);
    else topics.set(topic, [...(topics.get(topic) ?? []), d.key]);
  }

  return {
    queries: [
      ...base.map((text) => ({ group: "base" as const, text, outlets: [], dimensions: [] })),
      ...restricted.slice(0, RESEARCH_CONFIG.maxOutletQueries),
      ...[...topics]
        .slice(0, RESEARCH_CONFIG.maxTopicQueries)
        .map(([topic, keys]) => ({ group: "topics" as const, text: words(title, author, topic), outlets: [], dimensions: keys })),
    ],
    withoutTopic,
  };
}

/** Every fixed word a query may hold: the words for "review" and the topic words (not titles or names) */
export function fixedQueryWords(): string[] {
  return [...new Set([...Object.values(REVIEW_WORDS), ...Object.values(TOPIC_WORDS)].flatMap((w) => [w, ...w.split(/\s+/)]))];
}

import type { DurtalLocator } from "../engine";
import type { SearchOptions, TextMatch } from "./fold";

export interface SearchRequest {
  query: string;
  options: SearchOptions;
  signal: AbortSignal;
  startSection?: number;
}
export interface SearchHit extends TextMatch {
  id: string;
  locator: DurtalLocator;
  sectionLabel: string;
  linear: boolean;
  inNote: boolean;
  noteHref?: string;
  excerpt: { before: string; match: string; after: string };
}
export type SearchUpdate =
  | { kind: "hits"; hits: SearchHit[] }
  | { kind: "progress"; completed: number; total: number }
  | { kind: "complete"; capped: boolean; count: number };
export type WorkerRequest =
  | {
      kind: "search";
      id: number;
      key: string;
      text: string;
      query: string;
      options: SearchOptions;
      language: string;
      limit: number;
    }
  | { kind: "ack"; id: number }
  | { kind: "cancel" };
export type WorkerResponse =
  | { kind: "matches"; id: number; matches: TextMatch[] }
  | { kind: "done"; id: number }
  | { kind: "error"; id: number; message: string }
  | { kind: "cancelled" };

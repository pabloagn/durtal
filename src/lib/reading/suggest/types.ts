import type { PacePriors } from "../pace";
import type { QueueEdition } from "../queue";
import type { SeriesVolume } from "../series";
import type { FeedbackReason, FeedbackSource, FeedbackVerdict } from "../constants";
import type { PredictionGate } from "@/lib/validations/settings";

/*
 * The suggestion engine's data (SLN-457): every book of the catalogue as one
 * load gives it, and what is derived from them once per request (his mean
 * rating, the base rate of 4-or-more, the taxonomy's IDF and his taste
 * profile). Pure: unit tests build it from fixtures with buildContext.
 */

export interface SuggestAuthor {
  id: string;
  name: string;
  slug: string | null;
}

export interface SuggestRecommender {
  id: string;
  name: string;
}

/** A taxonomy term or a coarse fact, as a key ("s:<id>" a subject, "l:fr" a language) and its name */
export interface SuggestTerm {
  key: string;
  name: string;
}

export interface SuggestFeedback {
  verdict: FeedbackVerdict;
  reasons: FeedbackReason[];
  note: string | null;
  /** YYYY-MM-DD, for not_now */
  until: string | null;
  source: FeedbackSource;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestBook {
  id: string;
  title: string;
  slug: string | null;
  authors: SuggestAuthor[];
  /** The translators of its editions */
  translatorIds: string[];
  recommenders: SuggestRecommender[];
  /** Subjects, themes, movements, categories, attributes and keywords, plus its work type, original language and century */
  terms: SuggestTerm[];
  seriesId: string | null;
  seriesTitle: string | null;
  seriesPosition: string | null;
  workTypeId: string | null;
  originalLanguage: string | null;
  isFavourite: boolean;
  isPoison: boolean;
  catalogueStatus: string;
  /** works.rating, his current verdict */
  rating: number | null;
  /** Taste evidence: the book's rating of a book with a finished reading (tasteRatingSql), else null */
  taste: number | null;
  finishedCount: number;
  /** A reading or paused reading is open */
  open: boolean;
  /** Any reading at all, whatever its status */
  hasReading: boolean;
  lastFinishedOn: string | null;
  /** A reading started after the last finish */
  readSinceFinish: boolean;
  owned: boolean;
  /** Its place in Up Next (1 for the top), else null */
  queuePlace: number | null;
  queueEditionId: string | null;
  /** The earliest and latest acquisition date of a copy that is not deaccessioned */
  firstAcquired: string | null;
  lastAcquired: string | null;
  /** The copy at hand at the remembered home (atHandCopySql), else null */
  atHandCopyId: string | null;
  /** The homes where a copy is at hand (an available copy there, or a digital one) */
  atHandHomes: string[];
  editions: QueueEdition[];
  cover: string | null;
  feedback: SuggestFeedback | null;
}

export interface SuggestHome {
  id: string;
  name: string;
}

/** What one load returns, before the derived parts */
export interface SuggestLoad {
  /** The reading day, YYYY-MM-DD */
  today: string;
  /** The remembered home (the durtal-reading-home cookie), else null */
  homeId: string | null;
  homes: SuggestHome[];
  books: SuggestBook[];
  queueLength: number;
  priors: PacePriors;
  hideAnathema: boolean;
  gate: PredictionGate | null;
}

export interface SuggestContext extends SuggestLoad {
  byId: Map<string, SuggestBook>;
  /** C: the mean of his taste evidence, null without any */
  meanTaste: number | null;
  /** The books with taste evidence */
  rated: SuggestBook[];
  /** His base rate of 4 or more among them, as a beta estimate */
  baseLiked: number;
  /** log(books / books with the term), for every term */
  idf: Map<string, number>;
  /** His taste profile: for each term, the sum of (taste − C) over the rated books that have it */
  profile: Map<string, number>;
  series: Map<string, (SeriesVolume & { taste: number | null })[]>;
}

import { z } from "zod/v4";

/*
 * The suggestions' constraints from a URL (SLN-457), one parser for
 * /reading/suggestions and GET /api/readings/suggestions. Each value is
 * checked on its own: the page drops a bad one and keeps the rest; the API
 * answers 400 with the issues.
 */

export const SUGGESTION_SCOPES = ["owned", "next", "wanted", "all"] as const;
export const SUGGESTION_LENGTHS = ["any", "short", "medium", "long", "about"] as const;
/** Suggestions a page lists */
export const SUGGESTIONS_PER_PAGE = 24;

const uuidList = z
  .string()
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.uuid()).max(50));

const FIELDS = {
  scope: z.enum(SUGGESTION_SCOPES),
  length: z.enum(SUGGESTION_LENGTHS),
  /** "About N pages", within 15% */
  about: z.coerce.number().int().min(20).max(5000),
  /** The language he would read it in: its edition's */
  lang: z.string().regex(/^[a-z]{2,3}$/),
  /** At hand at this home */
  home: z.uuid(),
  /** Work types to leave out, comma-separated ids */
  skipTypes: uuidList,
  /** "1": leave out books that start a series he has not begun */
  noNewSeries: z.enum(["1"]).transform(() => true),
  page: z.coerce.number().int().min(1).max(1000),
  view: z.enum(["hidden"]),
  /** "1": open Pick one for me (the palette's Suggest a book) */
  pick: z.enum(["1"]).transform(() => true),
} as const;

export interface SuggestionParams {
  scope: (typeof SUGGESTION_SCOPES)[number];
  length: (typeof SUGGESTION_LENGTHS)[number];
  about?: number;
  lang?: string;
  home?: string;
  skipTypes: string[];
  noNewSeries: boolean;
  page: number;
  view?: "hidden";
  pick?: boolean;
}

export const DEFAULT_SUGGESTION_PARAMS: SuggestionParams = { scope: "owned", length: "any", skipTypes: [], noNewSeries: false, page: 1 };

type Raw = URLSearchParams | Record<string, string | string[] | undefined>;

const entries = (raw: Raw): [string, string][] =>
  raw instanceof URLSearchParams ? [...raw.entries()] : Object.entries(raw).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v[0] : v] as [string, string]]));

/**
 * The constraints and the problems: an unknown key or a bad value is an
 * issue and is left out. "About" without a number is "any".
 */
export function parseSuggestionParams(raw: Raw): { params: SuggestionParams; issues: { path: string; message: string }[] } {
  const params: SuggestionParams = { ...DEFAULT_SUGGESTION_PARAMS, skipTypes: [] };
  const issues: { path: string; message: string }[] = [];
  for (const [key, value] of entries(raw)) {
    if (value === "") continue;
    const field = FIELDS[key as keyof typeof FIELDS];
    if (!field) {
      issues.push({ path: key, message: `Unknown parameter ${key}` });
      continue;
    }
    const parsed = field.safeParse(value);
    if (!parsed.success) {
      issues.push({ path: key, message: parsed.error.issues[0]?.message ?? "Invalid value" });
      continue;
    }
    (params as unknown as Record<string, unknown>)[key] = parsed.data;
  }
  if (params.length === "about" && params.about === undefined) params.length = "any";
  return { params, issues };
}

/** The URL of these constraints, defaults left out ("" for none) */
export function suggestionQuery(p: Partial<SuggestionParams>): string {
  const q = new URLSearchParams();
  if (p.scope && p.scope !== "owned") q.set("scope", p.scope);
  if (p.length && p.length !== "any") q.set("length", p.length);
  if (p.length === "about" && p.about) q.set("about", String(p.about));
  if (p.lang) q.set("lang", p.lang);
  if (p.home) q.set("home", p.home);
  if (p.skipTypes?.length) q.set("skipTypes", p.skipTypes.join(","));
  if (p.noNewSeries) q.set("noNewSeries", "1");
  if (p.page && p.page > 1) q.set("page", String(p.page));
  if (p.view) q.set("view", p.view);
  const s = q.toString();
  return s ? `?${s}` : "";
}

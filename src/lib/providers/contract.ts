import { z } from "zod";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { providerSchema, sourceUrlSchema } from "@/lib/catalogue/provenance";

/*
 * The contract every metadata provider meets (SLN-375). A provider serves one
 * collection and names the record levels it describes. It can search, fetch
 * one item's detail and turn that detail into proposed field values. It never
 * writes: a detail is kept as a pending source observation, and a person
 * reviews each proposed value against the record before a service saves it.
 *
 * Providers are optional. No manual catalogue action, import or export calls
 * one, and a collection works the same with none.
 */

/** The record levels a provider can describe, per collection */
export const PROVIDER_LEVELS = {
  book: ["work", "edition"],
  perfume: ["work", "formulation"],
  film: ["work", "version", "release"],
  painting: ["work", "art_object"],
} as const satisfies Record<WorkKind, readonly string[]>;
export type ProviderLevel<K extends WorkKind = WorkKind> = (typeof PROVIDER_LEVELS)[K][number];

export interface ProviderLimits {
  /** Longest wait for one answer */
  timeoutMs: number;
  /** Shortest gap between two calls to the provider, from its terms */
  minIntervalMs: number;
  /** Most search results kept */
  maxResults: number;
}

export interface ProviderQuery<K extends WorkKind = WorkKind> {
  text: string;
  level: ProviderLevel<K>;
}

export const providerHitSchema = z.strictObject({
  externalId: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(1000),
  /** A second line: the maker, the date, the institution */
  detail: z.string().trim().max(1000).nullable().default(null),
  url: sourceUrlSchema.nullable().default(null),
});
export type ProviderHit = z.infer<typeof providerHitSchema>;

export const providerDetailSchema = z.strictObject({
  externalId: z.string().trim().min(1).max(500),
  /** The page a person can open to check the source */
  url: sourceUrlSchema.nullable(),
  /** Who to credit, as the provider asks to be credited */
  attribution: z.string().trim().min(1).max(1000),
  /** The license of the data or the image, when the provider states one */
  license: z.string().trim().min(1).max(300).nullable().default(null),
  /** The provider's answer as it came, kept with the observation */
  payload: z.record(z.string(), z.json()),
});
export type ProviderDetail = z.infer<typeof providerDetailSchema>;

/** Proposed values for one record level; the fields are the provider's own list */
export interface ProviderProposal<L extends string = string> {
  level: L;
  fields: Record<string, unknown>;
}

export interface ProviderContext {
  /** Aborts when the call runs out of time */
  signal: AbortSignal;
}

export interface ProviderAdapter<K extends WorkKind = WorkKind> {
  /** The `provider` of its identifiers and source observations */
  id: string;
  label: string;
  domain: K;
  levels: readonly ProviderLevel<K>[];
  /** The fields `normalize` may propose, per level */
  fields: Partial<Record<ProviderLevel<K>, readonly string[]>>;
  /** The provider's own documentation or terms that permit this use */
  documentation: string;
  /** It needs a key or an account; a provider without one may simply be off */
  needsKey: boolean;
  limits: ProviderLimits;
  search(query: ProviderQuery<K>, context: ProviderContext): Promise<unknown[]>;
  detail(externalId: string, context: ProviderContext): Promise<unknown>;
  /** Pure: the same detail always gives the same proposals */
  normalize(detail: ProviderDetail): ProviderProposal<ProviderLevel<K>>[];
}

/** Why a provider call gave no answer */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly reason: "timeout" | "rate_limited" | "unavailable" | "invalid" | "unsupported",
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** The problems of an adapter's declaration, or none */
export function adapterProblems(adapter: ProviderAdapter): string[] {
  const problems: string[] = [];
  if (!providerSchema.safeParse(adapter.id).success) problems.push(`${adapter.id}: the id must be a lowercase provider name`);
  const levels: readonly string[] = PROVIDER_LEVELS[adapter.domain] ?? [];
  if (!levels.length) problems.push(`${adapter.id}: ${String(adapter.domain)} is not a collection`);
  if (!adapter.levels.length) problems.push(`${adapter.id}: it must describe at least one level`);
  for (const level of adapter.levels)
    if (!levels.includes(level)) problems.push(`${adapter.id}: ${level} is not a level of ${adapter.domain}`);
  for (const level of Object.keys(adapter.fields))
    if (!adapter.levels.some((l) => l === level)) problems.push(`${adapter.id}: fields for ${level}, which it does not describe`);
  if (!/^https:\/\//.test(adapter.documentation)) problems.push(`${adapter.id}: the documentation must be an https link`);
  const { timeoutMs, minIntervalMs, maxResults } = adapter.limits;
  if (!(timeoutMs > 0 && timeoutMs <= 30000)) problems.push(`${adapter.id}: the time limit must be between 1 ms and 30 s`);
  if (!(minIntervalMs >= 0)) problems.push(`${adapter.id}: the gap between calls cannot be negative`);
  if (!(Number.isInteger(maxResults) && maxResults >= 1 && maxResults <= 100))
    problems.push(`${adapter.id}: it must keep between 1 and 100 results`);
  return problems;
}

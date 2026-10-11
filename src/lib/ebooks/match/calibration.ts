import { dataFingerprint, type LoadedMatchCatalogue } from "./load";
import { matchFingerprint } from "./keys";
import { MATCH_MODEL } from "./model";
import { matchInMemory } from "./tiers";
import { indexCatalogue } from "./catalogue";
import type { MatchEbook, MatchResult } from "./types";

export type SampleLabel = "right" | "wrong_edition" | "wrong_work";
export interface LabelledMatch {
  ebookId: string;
  fingerprint: string;
  tier: string;
  label: SampleLabel;
}
export interface ScoringBinding {
  modelVersion: number;
  modelFingerprint: string;
  catalogueFingerprint: string;
  inputFingerprint: string;
  externalInputFingerprint: string;
  inputPlanSha256: string;
  candidateFingerprint: string;
}
/** Independent of registration UUIDs: a source group's bytes/metadata keep
 * their identity when it becomes a real ebook. Multiplicity is preserved. */
export const scoringInputFingerprint = (ebooks: readonly MatchEbook[]) =>
  dataFingerprint(ebooks.map(matchFingerprint).sort());
/** Everything outside the registration overlay can affect duplicate preference,
 * shared identifiers and title frequency. Bind its decisions and file capability
 * evidence too; selected groups retain their UUID-independent binding above. */
export const externalScoringFingerprint = (
  ebooks: readonly MatchEbook[],
  selectedIds: ReadonlySet<string>,
) =>
  dataFingerprint(
    ebooks
      .filter((ebook) => !selectedIds.has(ebook.id))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
export interface CalibrationReceipt extends ScoringBinding {
  version: 1;
  sampleFingerprint: string;
  labels: readonly LabelledMatch[];
  automatic: {
    n: number;
    right: number;
    wrongWork: number;
    precision: number;
    lower95: number;
    upper95: number;
  };
}
export function wilson95(right: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.959963984540054,
    p = right / n,
    d = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}
export function sampleMatches(
  results: readonly MatchResult[],
  seed: string,
): MatchResult[] {
  const shuffled = (items: readonly MatchResult[]) =>
    [...items].sort((a, b) =>
      dataFingerprint([seed, a.ebookId]).localeCompare(
        dataFingerprint([seed, b.ebookId]),
      ),
    );
  const automatic = results.filter((row) => row.autoLink);
  const sample =
    automatic.length <= 300 ? automatic : shuffled(automatic).slice(0, 200);
  for (const tier of ["likely", "to_choose", "conflict", "not_in_durtal"])
    sample.push(
      ...shuffled(results.filter((row) => row.tier === tier)).slice(
        0,
        tier === "not_in_durtal" ? 100 : 50,
      ),
    );
  return sample.sort((a, b) => a.ebookId.localeCompare(b.ebookId));
}
export function scoreCalibration(
  binding: ScoringBinding,
  sample: readonly MatchResult[],
  labels: readonly LabelledMatch[],
): CalibrationReceipt {
  if (
    !sample.length ||
    labels.length !== sample.length ||
    new Set(labels.map((row) => row.ebookId)).size !== labels.length
  )
    throw new Error("The complete distinct sample must be labelled");
  for (const row of sample) {
    const label = labels.find((entry) => entry.ebookId === row.ebookId);
    if (
      !label ||
      label.fingerprint !== row.fingerprint ||
      label.tier !== row.tier ||
      !["right", "wrong_edition", "wrong_work"].includes(label.label)
    )
      throw new Error("Labels differ from the bound sample metadata or tier");
  }
  const autoIds = new Set(
    sample.filter((row) => row.autoLink).map((row) => row.ebookId),
  );
  const automaticLabels = labels.filter((row) => autoIds.has(row.ebookId));
  const n = automaticLabels.length,
    right = automaticLabels.filter((row) => row.label === "right").length,
    wrongWork = automaticLabels.filter(
      (row) => row.label === "wrong_work",
    ).length;
  const [lower95, upper95] = wilson95(right, n);
  return {
    version: 1,
    ...binding,
    sampleFingerprint: dataFingerprint(sample),
    labels: [...labels].sort((a, b) => a.ebookId.localeCompare(b.ebookId)),
    automatic: {
      n,
      right,
      wrongWork,
      precision: n ? right / n : 0,
      lower95,
      upper95,
    },
  };
}
/** A receipt is evidence for this exact model/catalogue/input set. Recompute
 * its counts from the bound sample rather than trusting editable CSV totals. */
export function requireCalibration(
  receipt: CalibrationReceipt,
  binding: ScoringBinding,
  sample: readonly MatchResult[],
): void {
  const rebuilt = scoreCalibration(binding, sample, receipt.labels);
  if (
    dataFingerprint(receipt) !== dataFingerprint(rebuilt) ||
    receipt.automatic.n === 0 ||
    receipt.automatic.precision < 0.99 ||
    receipt.automatic.wrongWork !== 0
  )
    throw new Error(
      "Automatic linking needs valid labelled precision for this model, catalogue and input fingerprint",
    );
}
/** Read-only scoring for SLN-498's inspected, not-yet-registered groups. The
 * caller supplies loader-proven file DTOs; this function never allocates or writes. */
export function scoreNewGroups(
  loaded: LoadedMatchCatalogue,
  groups: readonly MatchEbook[],
  inputPlanSha256: string,
) {
  if (!/^[a-f0-9]{64}$/.test(inputPlanSha256))
    throw new Error("Scoring requires the frozen ingestion input plan hash");
  const groupIds = new Set(groups.map((group) => group.id));
  if (groupIds.size !== groups.length)
    throw new Error("Duplicate scoring group keys");
  const catalogue = indexCatalogue({
    ...loaded.catalogue.source,
    ebooks: [
      ...loaded.catalogue.source.ebooks.filter(
        (ebook) => !groupIds.has(ebook.id),
      ),
      ...groups,
    ],
  });
  const results = matchInMemory(groups, catalogue);
  const binding: ScoringBinding = {
    modelVersion: MATCH_MODEL.version,
    modelFingerprint: dataFingerprint(MATCH_MODEL),
    catalogueFingerprint: loaded.catalogueFingerprint,
    inputFingerprint: scoringInputFingerprint(groups),
    externalInputFingerprint: externalScoringFingerprint(
      loaded.catalogue.source.ebooks,
      groupIds,
    ),
    inputPlanSha256,
    candidateFingerprint: dataFingerprint(results),
  };
  return {
    binding,
    results,
    sample: sampleMatches(results, dataFingerprint(binding)),
  };
}

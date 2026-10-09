import { isDeepStrictEqual } from "node:util";
import { isReadableFormat } from "./formats";
import { isSha256, parseStageKey } from "./keys";
import { MEDALLION_VERSION, hashBytes, medallionOf, type StageObject } from "./medallion";
import { getEbookObjectRange, objectMatches } from "./storage";
import type { PlanFile } from "./ingest/plan";

/** Fail before creating a run when a new plan has inconsistent or noncanonical stage references. */
export function validateStagePlan(file: PlanFile) {
  const stages = medallionOf(file.metadata);
  if (!stages || !isDeepStrictEqual(stages, file.medallion)) throw new Error("The plan's medallion references differ");
  for (const object of [stages.bronze, stages.silver, ...stages.gold]) {
    const key = parseStageKey(object.key);
    if (!key || key.sha256 !== file.sha256 || key.format !== file.format || !isSha256(object.sha256) || !Number.isSafeInteger(object.size) || object.size <= 0)
      throw new Error("Invalid planned e-book stage object");
  }
  const bronze = parseStageKey(stages.bronze.key)!;
  const silver = parseStageKey(stages.silver.key)!;
  if (
    bronze.stage !== "bronze" ||
    stages.bronze.sha256 !== file.sha256 ||
    stages.bronze.size !== file.size ||
    silver.stage !== "silver" ||
    silver.reportHash !== stages.silver.sha256
  )
    throw new Error("Invalid bronze/silver lineage");
  const accepted = stages.validation.integrity === "verified" && stages.validation.drm === "clear" && stages.validation.downloadable;
  if (
    (stages.validation.nativeReadable && (!accepted || !isReadableFormat(file.format))) ||
    stages.validation.downloadable !== !!accepted ||
    (!accepted && (stages.gold.length || file.derived.length || file.key !== stages.bronze.key))
  )
    throw new Error("Unvalidated gold publication");
  if (accepted) {
    const objects = stages.gold;
    const original = parseStageKey(objects[0]?.key ?? "");
    const marker = parseStageKey(objects.at(-1)?.key ?? "");
    if (
      original?.stage !== "gold" ||
      original.kind !== "file" ||
      objects[0].sha256 !== file.sha256 ||
      objects[0].size !== file.size ||
      file.key !== objects[0].key ||
      marker?.name !== "manifest.json" ||
      file.manifestKey !== objects.at(-1)?.key ||
      objects.length !== file.derived.length + 1
    )
      throw new Error("Incomplete planned gold publication");
    for (const [i, derived] of file.derived.entries()) {
      const key = parseStageKey(derived.key);
      if (
        key?.stage !== "gold" ||
        key.kind !== "derived" ||
        key.reportHash !== stages.silver.sha256 ||
        JSON.stringify({
          key: derived.key,
          sha256: derived.sha256,
          size: derived.size,
          contentType: derived.contentType,
        }) !==
          JSON.stringify({
            key: objects[i + 1].key,
            sha256: objects[i + 1].sha256,
            size: objects[i + 1].size,
            contentType: objects[i + 1].contentType,
          })
      )
        throw new Error("Invalid planned derived publication");
    }
  }
}

async function readJson(object: StageObject): Promise<Record<string, unknown>> {
  if (object.size > 8 * 1024 * 1024) throw new Error("Publication evidence exceeds its limit");
  const result = await getEbookObjectRange(object.key, 0, object.size - 1);
  if (!result) throw new Error("Publication evidence is missing");
  const bytes = new Uint8Array(await new Response(result.body).arrayBuffer());
  if (bytes.length !== object.size || hashBytes(bytes) !== object.sha256) throw new Error("Publication evidence checksum differs");
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

/** Recovery and reconciliation verify every stage, including each derived width and marker. */
export async function verifyPublication(metadata: unknown): Promise<string | null> {
  const stages = medallionOf(metadata);
  if (!stages) return metadata && typeof metadata === "object" && "medallion" in metadata ? "Malformed publication evidence" : null;
  try {
    const bronze = parseStageKey(stages.bronze.key);
    const silver = parseStageKey(stages.silver.key);
    if (
      bronze?.stage !== "bronze" ||
      bronze.sha256 !== stages.bronze.sha256 ||
      silver?.stage !== "silver" ||
      silver.sha256 !== bronze.sha256 ||
      silver.format !== bronze.format ||
      silver.reportHash !== stages.silver.sha256
    )
      return "Invalid publication lineage";
    for (const object of [stages.bronze, stages.silver, ...stages.gold]) {
      const key = parseStageKey(object.key);
      if (!key || key.sha256 !== bronze.sha256 || key.format !== bronze.format || !(await objectMatches(object.key, object.size, object.sha256)))
        return `Publication object missing or differs: ${object.key}`;
    }
    for (const object of stages.gold) {
      const key = parseStageKey(object.key)!;
      if (key.stage !== "gold" || (key.kind === "derived" && key.reportHash !== stages.silver.sha256)) return "Gold report identity differs";
    }
    const report = await readJson(stages.silver);
    if (report.version !== MEDALLION_VERSION || !isDeepStrictEqual(report.source, stages.bronze) || !isDeepStrictEqual(report.validation, stages.validation))
      return "Silver validation differs from the publication";
    if (!stages.validation.downloadable) return stages.gold.length ? "Unvalidated gold publication" : null;
    if (stages.validation.integrity !== "verified" || stages.validation.drm !== "clear") return "Gold lacks verified integrity/DRM validation";
    const original = stages.gold[0];
    if (
      parseStageKey(original?.key ?? "")?.kind !== "file" ||
      original.sha256 !== stages.bronze.sha256 ||
      original.size !== stages.bronze.size ||
      (stages.validation.nativeReadable && !isReadableFormat(bronze.format))
    )
      return "Gold source or reader capability differs";
    const marker = stages.gold.at(-1);
    if (!marker || parseStageKey(marker.key)?.name !== "manifest.json") return "Gold publication marker is missing";
    const artifacts = report.artifacts as { name: string; sha256: string; size: number }[] | undefined;
    for (const object of stages.gold.slice(1, -1)) {
      const name = parseStageKey(object.key)?.name;
      if (!artifacts?.some((a) => a.name === name && a.sha256 === object.sha256 && a.size === object.size)) return "Gold artifact differs from silver evidence";
    }
    const manifest = await readJson(marker);
    const lineage = manifest.medallion as
      | {
          version?: number;
          bronze?: StageObject;
          silver?: StageObject;
          artifacts?: StageObject[];
          validation?: unknown;
        }
      | undefined;
    if (
      lineage?.version !== MEDALLION_VERSION ||
      !isDeepStrictEqual(lineage?.bronze, stages.bronze) ||
      !isDeepStrictEqual(lineage?.silver, stages.silver) ||
      !isDeepStrictEqual(lineage?.validation, stages.validation) ||
      !isDeepStrictEqual(lineage?.artifacts, stages.gold.slice(0, -1))
    )
      return "Gold publication marker differs from its artifacts";
    return null;
  } catch {
    return "Publication evidence is unreadable or differs";
  }
}

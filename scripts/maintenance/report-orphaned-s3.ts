/**
 * Read-only report of gold/ objects that no database row references.
 * It never deletes anything.
 *
 *   node --env-file=.env.local --import tsx scripts/maintenance/report-orphaned-s3.ts
 */
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET } from "../../src/lib/s3/client";
import { keysInUse } from "../../src/lib/s3/cleanup";

// An upload writes the object before its row, so skip objects younger than a day.
const MINIMUM_AGE_HOURS = 24;
const cutoff = Date.now() - MINIMUM_AGE_HOURS * 60 * 60 * 1000;

const candidates: { key: string; size: number; modified: string }[] = [];
let token: string | undefined;
do {
  const page = await s3.send(
    new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: "gold/",
      ContinuationToken: token,
    }),
  );
  for (const object of page.Contents ?? []) {
    if (object.Key && object.LastModified && object.LastModified.getTime() < cutoff)
      candidates.push({
        key: object.Key,
        size: object.Size ?? 0,
        modified: object.LastModified.toISOString(),
      });
  }
  if (page.IsTruncated && !page.NextContinuationToken)
    throw new Error("S3 listing was truncated without a continuation token");
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);

const orphans: typeof candidates = [];
for (let offset = 0; offset < candidates.length; offset += 1000) {
  const batch = candidates.slice(offset, offset + 1000);
  const inUse = await keysInUse(batch.map((object) => object.key));
  orphans.push(...batch.filter((object) => !inUse.has(object.key)));
}

console.log(
  JSON.stringify(
    {
      mode: "report-only",
      bucket: S3_BUCKET,
      minimumAgeHours: MINIMUM_AGE_HOURS,
      scanned: candidates.length,
      orphans: orphans.length,
      totalBytes: orphans.reduce((sum, object) => sum + object.size, 0),
      objects: orphans,
    },
    null,
    2,
  ),
);

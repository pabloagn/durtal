/**
 * Read-only report of gold/ and bronze/evidence/ objects that no database row
 * references (evidence keys are named in source_records payloads, SLN-468),
 * and of the e-book bucket's files/ and derived/ objects that no ebook_files
 * row names (SLN-491). It never deletes anything.
 *
 *   node --env-file=.env.local --import tsx scripts/maintenance/report-orphaned-s3.ts
 */
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET } from "../../src/lib/s3/client";
import { keysInUse } from "../../src/lib/s3/cleanup";
import { EVIDENCE_PREFIX } from "../../src/lib/s3/keys";
import { db } from "../../src/lib/db";
import { ebookOrphanReport } from "../../src/lib/ebooks/verify";

// An upload writes the object before its row, so skip objects younger than a day.
const MINIMUM_AGE_HOURS = 24;
const cutoff = Date.now() - MINIMUM_AGE_HOURS * 60 * 60 * 1000;

const PREFIXES = ["gold/", EVIDENCE_PREFIX];

const candidates: { key: string; size: number; modified: string }[] = [];
for (const prefix of PREFIXES) {
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (
        object.Key && !object.Key.startsWith("gold/ebooks/") &&
        object.LastModified &&
        object.LastModified.getTime() < cutoff
      )
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
}

const orphans: typeof candidates = [];
for (let offset = 0; offset < candidates.length; offset += 1000) {
  const batch = candidates.slice(offset, offset + 1000);
  const inUse = await keysInUse(batch.map((object) => object.key));
  orphans.push(...batch.filter((object) => !inUse.has(object.key)));
}

// The e-book bucket: the same 24-hour rule (an upload writes its objects
// first); before the AWS setup it does not exist, and the report says so
const ebooks = await ebookOrphanReport(db);

console.log(
  JSON.stringify(
    {
      mode: "report-only",
      bucket: S3_BUCKET,
      prefixes: PREFIXES,
      minimumAgeHours: MINIMUM_AGE_HOURS,
      scanned: candidates.length,
      orphans: orphans.length,
      totalBytes: orphans.reduce((sum, object) => sum + object.size, 0),
      objects: orphans,
      ebooks,
    },
    null,
    2,
  ),
);

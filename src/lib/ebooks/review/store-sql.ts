import { sql, type SQL } from "drizzle-orm";
import { reviewPayloadHash } from "./receipts";

/** PostgreSQL has no ISO year zero. Only AD 0001..9999 is losslessly
 * representable by the strict four-digit UTC schema. Compare actual instants,
 * not YYYY output (which silently drops a BCE era). NULL/infinity fail closed. */
export function reviewTimestampIsValidSql(value: SQL): SQL {
  return sql`(isfinite(${value})
    and ${value} >= '0001-01-01T00:00:00Z'::timestamptz
    and ${value} < '10000-01-01T00:00:00Z'::timestamptz) IS TRUE`;
}
/** All snapshots are database text. No JavaScript Date touches a version guard.
 * Invalid instants cannot masquerade as a canonical AD string. Callers also
 * assert validity so NULL never becomes accepted snapshot evidence. */
export function reviewTimestampSql(value: SQL): SQL {
  return sql`case when ${reviewTimestampIsValidSql(value)} then
    to_char(${value} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') else null end`;
}
/** Exact pinned Zod 4.3.6 z.uuid() language for PostgreSQL's canonical
 * lowercase uuid::text, including nil/max exceptions. SQL uuid typing alone
 * accepts invalid versions/variants and cannot establish this restriction. */
export const REVIEW_UUID_PATTERN = "^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$";
export function reviewNullableUuidSql(value: SQL): SQL {
  return sql`(${value} is null or ${value}::text ~ ${REVIEW_UUID_PATTERN}) IS TRUE`;
}
export function candidateSnapshotTimesAreValidSql(ebookId: SQL): SQL {
  return sql`not exists(select 1 from ebook_match_candidates c
    where c.ebook_id=${ebookId} and not (${reviewTimestampIsValidSql(sql`c.created_at`)}))`;
}
/** Full raw snapshot timestamps must also remain lossless when normalized. */
export function ebookSnapshotTimesAreValidSql(): SQL {
  return sql`(${reviewTimestampIsValidSql(sql`e.created_at`)}
    and ${reviewTimestampIsValidSql(sql`e.updated_at`)}
    and ${candidateSnapshotTimesAreValidSql(sql`e.id`)}) IS TRUE`;
}
export function candidateSnapshotTextSql(): SQL {
  return sql`(to_jsonb(c) || jsonb_build_object('created_at',
    ${reviewTimestampSql(sql`c.created_at`)}))::text`;
}
/** Canonical outer array of strings; preserve the complete inner DB row text. */
export function candidateHashSql(ebookId: SQL): SQL {
  return sql`(select encode(sha256(convert_to('[' || coalesce(
    string_agg(to_jsonb(${candidateSnapshotTextSql()})::text, ',' order by c.rank,c.id),
    '') || ']', 'UTF8')), 'hex') from ebook_match_candidates c where c.ebook_id=${ebookId})`;
}
export function candidateTextsSql(ebookId: SQL): SQL {
  return sql`(select coalesce(jsonb_agg(${candidateSnapshotTextSql()} order by c.rank,c.id),
    '[]'::jsonb) from ebook_match_candidates c where c.ebook_id=${ebookId})`;
}
export function ebookRawSnapshotSql(): SQL {
  return sql`(to_jsonb(e) || jsonb_build_object('created_at',
    ${reviewTimestampSql(sql`e.created_at`)},'updated_at',${reviewTimestampSql(sql`e.updated_at`)}))::text`;
}
export function activityRawSnapshotSql(): SQL {
  return sql`(to_jsonb(a) || jsonb_build_object('created_at',
    ${reviewTimestampSql(sql`a.created_at`)}))::text`;
}
export function ebookSnapshotSql(): SQL {
  return sql`jsonb_build_object(
    'matchState',e.match_state,'matchTier',e.match_tier,
    'matchFingerprint',e.match_fingerprint,'updatedAt',${reviewTimestampSql(sql`e.updated_at`)},
    'instanceId',e.instance_id,'exclusionReason',e.exclusion_reason,
    'candidatesHash',${candidateHashSql(sql`e.id`)})`;
}
/** The after object is built with exactly the strict schema's keys from actual
 * typed columns. Static fields are parsed using the real seed schema and the
 * final stored object is compared in full to that seed + this DB projection. */
export function actualAfterIsValidSql(): SQL {
  return sql`(
    e.match_state in ('pending','linked','standalone','excluded')
    and (e.match_tier is null or e.match_tier in (
      'exact','strong','likely','to_choose','same_author','conflict','duplicate',
      'not_a_book','not_in_durtal'))
    and (e.match_fingerprint is null or e.match_fingerprint ~ '^[0-9a-f]{64}$')
    and (e.exclusion_reason is null or e.exclusion_reason in ('duplicate','not_a_book','other'))
    and ((e.match_state='linked')=(e.instance_id is not null))
    and ${reviewNullableUuidSql(sql`e.instance_id`)}
    and ((e.match_state='excluded')=(e.exclusion_reason is not null))
    and (e.match_state='pending' or e.match_tier is null)
    and (e.match_state='pending' or ${candidateHashSql(sql`e.id`)}=${reviewPayloadHash([])})
    and ${ebookSnapshotTimesAreValidSql()}
    and ${reviewTimestampSql(sql`e.updated_at`)} ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$'
  ) IS TRUE`;
}
export const REVIEW_RESULT_MARKER = "durtal.ebook.review.rows.v1";

import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { contentTypeFor, EBOOK_FORMATS, READABLE_FORMATS } from "./formats";
import { ebooksPrefix } from "./keys";
import { MEDALLION_VERSION } from "./medallion";

/** Alias expressions only; no connection or schema import. */
export interface EbookFileSqlColumns {
  status: SQLWrapper;
  drm: SQLWrapper;
  s3Key: SQLWrapper;
  sha256: SQLWrapper;
  sizeBytes: SQLWrapper;
  format: SQLWrapper;
  metadata: SQLWrapper;
  manifestKey?: SQLWrapper;
}

const strings = (values: readonly string[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
const record = (value: SQL) => sql`jsonb_typeof(${value}) = 'object'`;
const text = (value: SQL) => sql`jsonb_typeof(${value}) = 'string'`;
function positiveSafeInteger(value: SQL): SQL {
  // CASE guards casts even when the planner reorders surrounding predicates.
  return sql`case when jsonb_typeof(${value}) = 'number' then
    (${value} #>> '{}')::numeric between 1 and 9007199254740991
    and trunc((${value} #>> '{}')::numeric) = (${value} #>> '{}')::numeric else false end`;
}
function stageObject(value: SQL): SQL {
  return sql`(${record(value)} and ${text(sql`${value}->'key'`)}
    and ${text(sql`${value}->'sha256'`)} and ${value}->>'sha256' ~ '^[a-f0-9]{64}$'
    and ${positiveSafeInteger(sql`${value}->'size'`)} and ${text(sql`${value}->'contentType'`)})`;
}
const readableFormat = (f: EbookFileSqlColumns) =>
  sql`${f.format} in (${strings(READABLE_FORMATS)})`;

/** SQL counterpart of acceptedPublication: every array operation is guarded. */
function publication(f: EbookFileSqlColumns): SQL {
  const m = sql`${f.metadata}->'medallion'`;
  const bronze = sql`${m}->'bronze'`;
  const silver = sql`${m}->'silver'`;
  const validation = sql`${m}->'validation'`;
  const gold = sql`case when jsonb_typeof(${m}->'gold') = 'array' then ${m}->'gold' else '[]'::jsonb end`;
  const original = sql`(${gold})->0`;
  const marker = sql`(${gold})->-1`;
  const extension = sql`case when ${f.format} = 'other' then 'bin' else ${f.format} end`;
  const folder = sql`('ebooks/' || ${f.format} || '/' || left(${f.sha256}, 2) || '/' || ${f.sha256})`;
  const derived = sql`('gold/' || ${folder} || '/derived/v2/' || (${silver}->>'sha256') || '/')`;
  const contentType = sql`case ${f.format} ${sql.join(
    EBOOK_FORMATS.map(
      (format) => sql`when ${format} then ${contentTypeFor(format)}`,
    ),
    sql` `,
  )} end`;
  return sql`(${record(m)} and ${m}->'version' = to_jsonb(${MEDALLION_VERSION}::integer)
    and ${record(validation)} and ${validation}->'integrity' = '"verified"'::jsonb
    and ${validation}->'drm' = '"clear"'::jsonb and ${validation}->'downloadable' = 'true'::jsonb
    and jsonb_typeof(${validation}->'nativeReadable') = 'boolean'
    and (${validation}->'reason' = 'null'::jsonb or ${text(sql`${validation}->'reason'`)})
    and (${validation}->'nativeReadable' = 'false'::jsonb or ${readableFormat(f)})
    and ${stageObject(bronze)} and ${stageObject(silver)}
    and ${bronze}->>'key' = ('bronze/' || ${folder} || '/source.' || ${extension})
    and ${bronze}->>'sha256' = ${f.sha256} and ${bronze}->'size' = to_jsonb(${f.sizeBytes})
    and ${bronze}->>'contentType' = ${contentType}
    and ${silver}->>'key' = ('silver/' || ${folder} || '/v2/' || (${silver}->>'sha256') || '.json')
    and ${silver}->>'contentType' = 'application/json'
    and jsonb_array_length(${gold}) between 2 and 5
    and ${original}->>'key' = ${f.s3Key} and ${original}->>'sha256' = ${f.sha256}
    and ${original}->'size' = to_jsonb(${f.sizeBytes}) and ${original}->>'contentType' = ${contentType}
    and ${marker}->>'key' = (${derived} || 'manifest.json') and ${marker}->>'contentType' = 'application/json'
    ${f.manifestKey ? sql`and ${marker}->>'key' = ${f.manifestKey}` : sql``}
    and not exists (select 1 from jsonb_array_elements(${gold}) with ordinality as artifact(object, ordinal)
      where not coalesce((${stageObject(sql`artifact.object`)} and
        case when artifact.ordinal = 1 then artifact.object->>'key' = ${f.s3Key}
          when artifact.ordinal = jsonb_array_length(${gold}) then artifact.object->>'key' = (${derived} || 'manifest.json')
          else artifact.object->>'key' in (${derived} || 'cover-240.webp', ${derived} || 'cover-400.webp', ${derived} || 'cover-800.webp')
            and artifact.object->>'contentType' = 'image/webp' end), false))
    and (select count(distinct artifact.object->>'key') from jsonb_array_elements(${gold}) as artifact(object)) = jsonb_array_length(${gold}))`;
}

export function ebookFileDownloadableCondition(f: EbookFileSqlColumns): SQL {
  const extension = sql`case when ${f.format} = 'other' then 'bin' else ${f.format} end`;
  const legacy = sql`${f.s3Key} = (${ebooksPrefix()} || 'files/' || left(${f.sha256}, 2) || '/' || ${f.sha256} || '.' || ${extension})`;
  const gold = sql`${f.s3Key} = ('gold/ebooks/' || ${f.format} || '/' || left(${f.sha256}, 2) || '/' || ${f.sha256} || '/file.' || ${extension})`;
  return sql`coalesce((${f.status} in ('stored', 'verified') and ${f.drm} is null
    and ${f.sha256} ~ '^[a-f0-9]{64}$' and ${f.format} in (${strings(EBOOK_FORMATS)})
    and ${f.sizeBytes} between 1 and 9007199254740991 and trunc(${f.sizeBytes}::numeric) = ${f.sizeBytes}
    and ${record(sql`${f.metadata}`)}
    and ((${legacy} and not (${f.metadata} ? 'medallion')) or (${gold} and ${publication(f)}))), false)`;
}

export function ebookFileNativeReadableCondition(f: EbookFileSqlColumns): SQL {
  return sql`(${ebookFileDownloadableCondition(f)} and ${readableFormat(f)}
    and (not (${f.metadata} ? 'medallion') or ${f.metadata}->'medallion'->'validation'->'nativeReadable' = 'true'::jsonb))`;
}

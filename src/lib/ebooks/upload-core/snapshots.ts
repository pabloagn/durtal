import { sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import type { UploadAtomicBinding } from "../upload/atomic-extension";
import { readUploadControlSnapshotsOn, readUploadTargetSnapshotOn, uploadTableSnapshotSql,
  UPLOAD_READER_TABLES as CANONICAL_READER_TABLES } from "../upload/atomic-snapshots";
import type { CoreScope } from "./store";
import { uploadTargetRowsFingerprint } from "../ingest/upload-atomic";
import { UploadError } from "../upload/protocol";

export const UPLOAD_READER_TABLES=CANONICAL_READER_TABLES;
export interface UploadSnapshots {
  command:Record<string,unknown>;job:Record<string,unknown>;capacity:Record<string,unknown>;
  target:UploadAtomicBinding["targetSnapshot"];readerSha256:string;timezone:string;
  scope:{ebookIds:readonly string[];runId:string};
}
/** Complete database row bytes hashed inside PostgreSQL. This also covers
 * future reader columns and quote-note relations without guessing locators.
 * Keeping only the digest avoids storing all reader passages in a receipt.
 */
export function uploadReaderHashSql(scope:{ebookIds:readonly string[];runId:string}):SQL {
  const pieces=UPLOAD_READER_TABLES.map((table)=>sql`jsonb_build_object('table',${table}::text,'rows',
    ${uploadTableSnapshotSql(table,scope)})`);
  return sql`encode(sha256(convert_to(jsonb_build_array(${sql.join(pieces,sql`, `)})::text,'UTF8')),'hex')`;
}
export async function readUploadSnapshotsOn(conn:Db,scope:CoreScope,uploadId:string,commandId:string,
  ebookIds:readonly string[]):Promise<UploadSnapshots> {
  const identity=await readUploadControlSnapshotsOn(conn,commandId,uploadId);
  if (identity.command.volume_id!==scope.volumeId || identity.command.target_fingerprint!==scope.context.targetFingerprint
    || identity.command.binding_sha256!==scope.context.bindingSha256 || identity.command.protocol_version!==1
    || identity.job.kind!=="upload") throw new UploadError(404,"upload_not_found","Upload command not found.");
  const targetScope={ebookIds:[...ebookIds].map((id)=>z.uuid().parse(id)),runId:z.uuid().parse(identity.job.run_id)};
  const target=await readUploadTargetSnapshotOn(conn,targetScope);
  const facts=resultRows<{readerSha256:string;timezone:string}>(await conn.execute(sql`
    select ${uploadReaderHashSql(targetScope)} as "readerSha256",current_setting('TimeZone') as timezone`));
  if (facts.length!==1) throw new Error("Upload reader snapshot missing");
  return {...identity,...facts[0],target,scope:targetScope};
}
export function targetFingerprintFromRows(target:Pick<UploadSnapshots["target"],"ebooks"|"ebook_files">,ebookId:string):string {
  return uploadTargetRowsFingerprint({ebooks:target.ebooks.filter((r)=>r.id===ebookId),
    ebook_files:target.ebook_files.filter((r)=>r.ebook_id===ebookId)});
}
export function settledUploadSql(uploadId:string):SQL {
  return sql`exists(select 1 from ebook_upload_operations j join ebook_upload_capacity c on c.volume_id=j.volume_id
    where j.id=${uploadId}::uuid and j.kind='upload' and j.state='ready' and j.receipt is not null
      and j.receipt_status=200 and j.cleanup_verified_at is not null and j.lease_token is null and j.lease_expires_at is null
      and j.reservation_released_at is null and j.reserved_bytes>0 and c.worker_state='idle'
      and c.worker_operation_id is null and c.worker_token is null and c.worker_lease_expires_at is null
      and c.active_part_writers=0 and coalesce(j.progress #> '{uploadV1,writers}','{}'::jsonb)='{}'::jsonb)`;
}

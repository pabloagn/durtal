import { sql, type SQL } from "drizzle-orm";

/**
 * Settle an upload's run in the same write that settles its last file
 * (SLN-1395). A file is settled once it is canceled or expired, or added: a
 * committed confirmation (an undo or restore after it leaves it settled). The
 * run stays "running" while any file is open, so a late file still registers;
 * it is "failed" when a file was given up on after its check failed, else
 * "finished". A no-op for a run already settled or not an upload's.
 */
export function settleUploadRunSql(runId: string): SQL {
  return sql`update ebook_ingest_runs r set state=case when exists(select 1 from ebook_upload_operations u
      where u.run_id=r.id and u.kind='upload' and u.state='canceled' and u.progress ? 'jobFailureV1') then 'failed' else 'finished' end,
    finished_at=clock_timestamp(),updated_at=clock_timestamp()
    where r.id=${runId}::uuid and r.kind='upload' and r.state='running'
      and exists(select 1 from ebook_upload_operations u where u.run_id=r.id and u.kind='upload')
      and not exists(select 1 from ebook_upload_operations u where u.run_id=r.id and u.kind='upload'
        and u.state not in ('canceled','expired') and not exists(select 1 from ebook_upload_operations e
          where e.parent_operation_id=u.id and e.input->>'action'='confirm' and e.state='completed'
            and e.receipt_status=200 and e.effect_committed_at is not null))`;
}

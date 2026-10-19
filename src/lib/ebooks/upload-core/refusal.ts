import { lockName } from "../locked-file";
import { uploadItemViewSchema, type UploadItemView } from "../upload/protocol";
import { readStoredInspection, type StoredUploadInspection } from "./inspection";
import type { CoreOperationRow } from "./store";

/** Why a checked file can't be added, in plain words, or null when it can: a
 * password is a password, a damaged file says what is wrong (SLN-1388) */
export function quarantineMessage(inspected:Pick<StoredUploadInspection,"prepared"|"publication">):string|null {
  const p=inspected.prepared;
  if (p.validation.downloadable && !p.problem && !p.drm && inspected.publication.medallion.gold[0]) return null;
  if (p.drm) return `Not added: the file is locked with ${lockName(p.drm)}. Upload a copy without it.`;
  if (p.problem) {
    const problem=p.problem.slice(0,800).trim(),first=/^[A-Z][a-z]/.test(problem) ? problem[0].toLowerCase()+problem.slice(1) : problem;
    return `Not added: ${first}${/[.!?]$/.test(first) ? "" : "."}`;
  }
  return "Not added: Durtal can't check files of this format yet.";
}

export const UNREADABLE_CHECK_MESSAGE="Not added: Durtal can't read this file's check. Cancel it and upload the file again.";

/** A checked file that can't be added says why on its own row, without Preview
 * (SLN-1388). One whose stored check can't be read says so on its row, and the
 * rest of its batch still shows (SLN-1467). */
export function checkedItemView(view:UploadItemView,upload:CoreOperationRow):UploadItemView {
  if (view.state!=="ready") return view;
  let refused:string|null;
  try { refused=quarantineMessage(readStoredInspection(upload)); }
  catch { refused=UNREADABLE_CHECK_MESSAGE; }
  return refused ? uploadItemViewSchema.parse({...view,message:refused,refused:true}) : view;
}

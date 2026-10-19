import { lockName } from "../locked-file";
import type { StoredUploadInspection } from "./inspection";

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

import type { ReaderMutation } from "./offline/mutations";
import type { PositionSave } from "./position-queue";

// Compare the complete JSON save, ignoring key order and omitted optional fields.
// This runs once at opening; it does not redefine page-turn or outbox equality.
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((value, index) => sameJson(value, b[index]));
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter(key => left[key] !== undefined).sort();
  const other = Object.keys(right).filter(key => right[key] !== undefined).sort();
  return keys.length === other.length && keys.every((key, index) =>
    key === other[index] && sameJson(left[key], right[key]));
}

/** An exact landing is recovery of the stored intent, not a new position save. */
export function isExactLocalOpeningPosition(
  local: ReaderMutation | null,
  landing: Omit<PositionSave, "clientUpdatedAt"> & { clientUpdatedAt: string | undefined },
  scope: { ebookId: string; fileId: string; fileHash: string; deviceId: string | null },
  exact: boolean,
): boolean {
  return !!(exact && local?.kind === "position" && scope.deviceId &&
    local.ebookId === scope.ebookId && local.deviceId === scope.deviceId &&
    local.fileId === scope.fileId && local.body.fileId === scope.fileId &&
    landing.fileId === scope.fileId && local.body.locator.fileHash === scope.fileHash &&
    landing.locator.fileHash === scope.fileHash && sameJson(local.body, landing));
}

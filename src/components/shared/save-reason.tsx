import { useId, type ReactNode } from "react";

/**
 * Why a save is unavailable, said beside the action and read with it: the
 * action takes `describedBy` as its `aria-describedby` (SLN-1057). `reason`
 * is the first thing missing, or nothing when the action can go ahead.
 * `place` keeps the line away from the action: "mr-auto" in a row that ends
 * with Cancel and Save, "ml-auto" where Back starts the row.
 */
export function useSaveReason(
  reason: string | null | false | undefined,
  place: "mr-auto" | "ml-auto" = "mr-auto",
): {
  hint: ReactNode;
  describedBy: string | undefined;
} {
  const id = useId();
  return reason
    ? { hint: <p id={id} className={`${place} text-xs text-fg-secondary`}>{reason}</p>, describedBy: id }
    : { hint: null, describedBy: undefined };
}

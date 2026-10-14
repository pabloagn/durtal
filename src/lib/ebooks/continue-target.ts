import type { DurtalLocator } from "@/lib/reader/engine";
import {
  isEbookFileNativeReadable,
  type EbookFileEligibility,
} from "./conditions";
import { formatRank } from "./formats";

export interface ContinueFile extends EbookFileEligibility {
  id: string;
  ebookId: string;
  createdAt: string | Date;
}

/** Structural input shared with reader positions; the caller supplies same-book rows. */
export interface ContinueAnchor {
  deviceId: string;
  deviceLabel: string;
  fileId: string;
  locator: DurtalLocator;
  chapter: string | null;
  clientUpdatedAt: string | Date;
}

export interface ContinueDescriptor {
  target: ContinueFile;
  href: string;
  /** Original identity and clock survive projection into another file. */
  anchor: ContinueAnchor | null;
  localAnchor: ContinueAnchor | null;
  /** Input to SLN-493's placeToOffer, never an automatic override of local intent. */
  newestOtherAnchor: ContinueAnchor | null;
  projection: "none" | "same-file" | "pending-reanchor";
  savedPercent: number | null;
  /** Unknown until the engine resolves a cross-file anchor. */
  targetPercent: number | null;
}

const at = (value: string | Date) =>
  value instanceof Date
    ? value.getTime()
    : typeof value === "string"
      ? Date.parse(value)
      : NaN;
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function validContinueAnchor(
  anchor: ContinueAnchor,
  source: ContinueFile | undefined,
): boolean {
  const locator = anchor?.locator;
  return (
    !!source &&
    !!locator &&
    typeof locator === "object" &&
    !Array.isArray(locator) &&
    Number.isFinite(at(anchor.clientUpdatedAt)) &&
    locator.v === 1 &&
    locator.fileHash === source.sha256 &&
    /^[a-f0-9]{64}$/.test(locator.fileHash) &&
    Number.isFinite(locator.totalProgression) &&
    locator.totalProgression >= 0 &&
    locator.totalProgression <= 1 &&
    Number.isFinite(locator.progression) &&
    locator.progression >= 0 &&
    locator.progression <= 1 &&
    Number.isInteger(locator.sectionIndex) &&
    locator.sectionIndex >= 0 &&
    typeof locator.href === "string"
  );
}

/**
 * A place that is being read (SLN-683): past the opening page and short of
 * the end. A book only opened on a device, or finished, is not "continue".
 */
export function underway(anchor: ContinueAnchor): boolean {
  return !opened(anchor) && anchor.locator.totalProgression < 0.995;
}
/** A place on the book's opening page: the book was opened, not started */
export function opened({ locator }: Pick<ContinueAnchor, "locator">): boolean {
  return locator.sectionIndex === 0 && locator.progression === 0;
}

/** Select bytes to open separately from the saved place used to find the landing. */
export function continueTarget(input: {
  ebookId: string;
  excluded: boolean;
  preferredFileId: string | null;
  deviceId: string | null;
  files: readonly ContinueFile[];
  positions: readonly ContinueAnchor[];
}): ContinueDescriptor | null {
  if (input.excluded) return null;
  const files = input.files.filter((file) => file.ebookId === input.ebookId);
  const sources = new Map(files.map((file) => [file.id, file]));
  const eligible = files
    .filter(isEbookFileNativeReadable)
    .sort(
      (a, b) =>
        formatRank(a.format) - formatRank(b.format) ||
        at(a.createdAt) - at(b.createdAt) ||
        compareIds(a.id, b.id),
    );
  if (!eligible.length) return null;
  // Historical files, including replaced ones, remain usable anchors; their bytes are not targets.
  const positions = input.positions
    .filter((position) =>
      validContinueAnchor(position, sources.get(position?.fileId)),
    )
    .sort(
      (a, b) =>
        at(b.clientUpdatedAt) - at(a.clientUpdatedAt) ||
        compareIds(a.deviceId, b.deviceId) ||
        compareIds(a.fileId, b.fileId),
    );
  const localAnchor = input.deviceId
    ? (positions.find((position) => position.deviceId === input.deviceId) ??
      null)
    : null;
  const newestOtherAnchor =
    positions.find((position) => position.deviceId !== input.deviceId) ?? null;
  const anchor = localAnchor ?? newestOtherAnchor;
  const target =
    eligible.find((file) => file.id === anchor?.fileId) ??
    eligible.find((file) => file.id === input.preferredFileId) ??
    eligible[0];
  const sameFile = !!anchor && anchor.fileId === target.id;
  const savedPercent = anchor
    ? Math.round(anchor.locator.totalProgression * 10_000) / 100
    : null;
  return {
    target,
    href: `/reader/${input.ebookId}?file=${target.id}`,
    anchor,
    localAnchor,
    newestOtherAnchor,
    projection: !anchor ? "none" : sameFile ? "same-file" : "pending-reanchor",
    savedPercent,
    targetPercent: sameFile ? savedPercent : null,
  };
}

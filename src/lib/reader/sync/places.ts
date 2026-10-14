import type { DurtalLocator } from "../engine";

/** One file/device row; the device cookie remains owned by the server. */
export interface ReaderPlace {
  deviceId: string;
  deviceLabel: string;
  fileId: string;
  locator: DurtalLocator;
  progression: number;
  furthestProgression: number;
  chapter: string | null;
  clientUpdatedAt: string;
  thisDevice: boolean;
}

export function isDifferentPlace(a: ReaderPlace, b: ReaderPlace): boolean {
  if (a.fileId !== b.fileId)
    return (
      Math.abs(a.locator.totalProgression - b.locator.totalProgression) >
      0.005 + Number.EPSILON
    );
  return (
    a.locator.sectionIndex !== b.locator.sectionIndex ||
    a.locator.href !== b.locator.href ||
    Math.abs(a.locator.progression - b.locator.progression) >
      0.02 + Number.EPSILON
  );
}

export function newestPlace(
  places: readonly ReaderPlace[],
): ReaderPlace | null {
  return places.reduce<ReaderPlace | null>(
    (latest, place) =>
      !latest ||
      Date.parse(place.clientUpdatedAt) > Date.parse(latest.clientUpdatedAt)
        ? place
        : latest,
    null,
  );
}

/** Compare the newest other place only: an older, different place is never a fallback offer. */
export function placeToOffer(
  thisDevice: ReaderPlace | null,
  others: readonly ReaderPlace[],
): ReaderPlace | null {
  const other = newestPlace(others.filter((place) => !place.thisDevice));
  if (!other) return null;
  if (!thisDevice) return other;
  return Date.parse(other.clientUpdatedAt) >
    Date.parse(thisDevice.clientUpdatedAt) &&
    isDifferentPlace(thisDevice, other)
    ? other
    : null;
}

/** The furthest other place, offered beside the newest when it is further than
 * both the newest and this device's place (SLN-686). */
export function furthestOffer(
  thisDevice: ReaderPlace | null,
  others: readonly ReaderPlace[],
  offered: ReaderPlace | null,
): ReaderPlace | null {
  if (!offered) return null;
  const furthest = others
    .filter((place) => !place.thisDevice)
    .reduce<ReaderPlace | null>((best, place) =>
      !best || place.locator.totalProgression > best.locator.totalProgression ? place : best, null);
  const beyond = (place: ReaderPlace | null) =>
    !place || furthest!.locator.totalProgression > place.locator.totalProgression + 0.005;
  return furthest && furthest !== offered && beyond(offered) && beyond(thisDevice) ? furthest : null;
}

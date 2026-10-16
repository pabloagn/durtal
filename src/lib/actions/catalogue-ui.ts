"use server";

import { actionResult } from "./action-result";
import * as films from "./films";
import * as paintings from "./paintings";
import * as perfumes from "./perfumes";
import * as perfume_retailers from "./perfume-retailers";
import * as acquisitions from "./acquisitions";
import * as publishers from "./publishers";
import * as reading from "./reading";

/** UI-only adapters; service and API contracts remain unchanged. */

export async function createFilmVersion(
  ...args: Parameters<typeof films.createFilmVersion>
) {
  return actionResult(() => films.createFilmVersion(...args));
}

export async function updateFilmVersion(
  ...args: Parameters<typeof films.updateFilmVersion>
) {
  return actionResult(() => films.updateFilmVersion(...args));
}

export async function deleteFilmVersion(
  ...args: Parameters<typeof films.deleteFilmVersion>
) {
  return actionResult(() => films.deleteFilmVersion(...args));
}

export async function createArtObject(
  ...args: Parameters<typeof paintings.createArtObject>
) {
  return actionResult(() => paintings.createArtObject(...args));
}

export async function updateArtObject(
  ...args: Parameters<typeof paintings.updateArtObject>
) {
  return actionResult(() => paintings.updateArtObject(...args));
}

export async function deleteArtObject(
  ...args: Parameters<typeof paintings.deleteArtObject>
) {
  return actionResult(() => paintings.deleteArtObject(...args));
}

export async function createPerfumeVariant(
  ...args: Parameters<typeof perfumes.createPerfumeVariant>
) {
  return actionResult(() => perfumes.createPerfumeVariant(...args));
}

export async function updatePerfumeVariant(
  ...args: Parameters<typeof perfumes.updatePerfumeVariant>
) {
  return actionResult(() => perfumes.updatePerfumeVariant(...args));
}

export async function deletePerfumeVariant(
  ...args: Parameters<typeof perfumes.deletePerfumeVariant>
) {
  return actionResult(() => perfumes.deletePerfumeVariant(...args));
}

export async function addPerfumeRetailerLink(
  ...args: Parameters<typeof perfume_retailers.addPerfumeRetailerLink>
) {
  return actionResult(() => perfume_retailers.addPerfumeRetailerLink(...args));
}

export async function recordRetailerObservation(
  ...args: Parameters<typeof perfume_retailers.recordRetailerObservation>
) {
  return actionResult(() =>
    perfume_retailers.recordRetailerObservation(...args),
  );
}

export async function archivePerfumeRetailerLink(
  ...args: Parameters<typeof perfume_retailers.archivePerfumeRetailerLink>
) {
  return actionResult(() =>
    perfume_retailers.archivePerfumeRetailerLink(...args),
  );
}

export async function deletePerfumeRetailerLink(
  ...args: Parameters<typeof perfume_retailers.deletePerfumeRetailerLink>
) {
  return actionResult(() =>
    perfume_retailers.deletePerfumeRetailerLink(...args),
  );
}

export async function createTypedTarget(
  ...args: Parameters<typeof acquisitions.createTypedTarget>
) {
  return actionResult(() => acquisitions.createTypedTarget(...args));
}

export async function orderTypedTarget(
  ...args: Parameters<typeof acquisitions.orderTypedTarget>
) {
  return actionResult(() => acquisitions.orderTypedTarget(...args));
}

export async function removeTypedTarget(
  ...args: Parameters<typeof acquisitions.removeTypedTarget>
) {
  return actionResult(() => acquisitions.removeTypedTarget(...args));
}

export async function savePublisher(
  ...args: Parameters<typeof publishers.savePublisher>
) {
  return actionResult(() => publishers.savePublisher(...args));
}

export async function createAcquisitionTarget(
  ...args: Parameters<typeof publishers.createAcquisitionTarget>
) {
  return actionResult(() => publishers.createAcquisitionTarget(...args));
}

export async function cancelAcquisitionTarget(
  ...args: Parameters<typeof publishers.cancelAcquisitionTarget>
) {
  return actionResult(() => publishers.cancelAcquisitionTarget(...args));
}

export async function fulfilTargetWithCopy(
  ...args: Parameters<typeof publishers.fulfilTargetWithCopy>
) {
  return actionResult(() => publishers.fulfilTargetWithCopy(...args));
}

export async function startReading(
  ...args: Parameters<typeof reading.startReading>
) {
  return actionResult(() => reading.startReading(...args));
}

export async function logProgress(
  ...args: Parameters<typeof reading.logProgress>
) {
  return actionResult(() => reading.logProgress(...args));
}

export async function startTimer(
  ...args: Parameters<typeof reading.startTimer>
) {
  return actionResult(() => reading.startTimer(...args));
}

export async function pauseTimer(
  ...args: Parameters<typeof reading.pauseTimer>
) {
  return actionResult(() => reading.pauseTimer(...args));
}

export async function resumeTimer(
  ...args: Parameters<typeof reading.resumeTimer>
) {
  return actionResult(() => reading.resumeTimer(...args));
}

export async function stopTimer(...args: Parameters<typeof reading.stopTimer>) {
  return actionResult(() => reading.stopTimer(...args));
}

export async function undoStopTimer(
  ...args: Parameters<typeof reading.undoStopTimer>
) {
  return actionResult(() => reading.undoStopTimer(...args));
}

export async function discardTimer(
  ...args: Parameters<typeof reading.discardTimer>
) {
  return actionResult(() => reading.discardTimer(...args));
}

export async function undoProgress(
  ...args: Parameters<typeof reading.undoProgress>
) {
  return actionResult(() => reading.undoProgress(...args));
}

export async function pauseReading(
  ...args: Parameters<typeof reading.pauseReading>
) {
  return actionResult(() => reading.pauseReading(...args));
}

export async function resumeReading(
  ...args: Parameters<typeof reading.resumeReading>
) {
  return actionResult(() => reading.resumeReading(...args));
}

export async function finishReading(
  ...args: Parameters<typeof reading.finishReading>
) {
  return actionResult(() => reading.finishReading(...args));
}

export async function abandonReading(
  ...args: Parameters<typeof reading.abandonReading>
) {
  return actionResult(() => reading.abandonReading(...args));
}

export async function reopenReading(
  ...args: Parameters<typeof reading.reopenReading>
) {
  return actionResult(() => reading.reopenReading(...args));
}

export async function addPastReading(
  ...args: Parameters<typeof reading.addPastReading>
) {
  return actionResult(() => reading.addPastReading(...args));
}

export async function updateReading(
  ...args: Parameters<typeof reading.updateReading>
) {
  return actionResult(() => reading.updateReading(...args));
}

export async function deleteReading(
  ...args: Parameters<typeof reading.deleteReading>
) {
  return actionResult(() => reading.deleteReading(...args));
}

export async function restoreReading(
  ...args: Parameters<typeof reading.restoreReading>
) {
  return actionResult(() => reading.restoreReading(...args));
}

export async function updateSession(
  ...args: Parameters<typeof reading.updateSession>
) {
  return actionResult(() => reading.updateSession(...args));
}

export async function addSession(
  ...args: Parameters<typeof reading.addSession>
) {
  return actionResult(() => reading.addSession(...args));
}

export async function restoreSession(
  ...args: Parameters<typeof reading.restoreSession>
) {
  return actionResult(() => reading.restoreSession(...args));
}

export async function deleteSession(
  ...args: Parameters<typeof reading.deleteSession>
) {
  return actionResult(() => reading.deleteSession(...args));
}

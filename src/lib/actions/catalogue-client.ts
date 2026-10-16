"use client";

import * as actions from "./catalogue-ui";
import type { ActionResult } from "./action-result";

/** Unwrap on the client, after the deliberate refusal crossed as data. */
async function value<T>(result: Promise<ActionResult<T>>): Promise<T> {
  const outcome = await result;
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.value;
}

export async function createFilmVersion(
  ...args: Parameters<typeof actions.createFilmVersion>
) {
  return value(actions.createFilmVersion(...args));
}

export async function updateFilmVersion(
  ...args: Parameters<typeof actions.updateFilmVersion>
) {
  return value(actions.updateFilmVersion(...args));
}

export async function deleteFilmVersion(
  ...args: Parameters<typeof actions.deleteFilmVersion>
) {
  return value(actions.deleteFilmVersion(...args));
}

export async function createArtObject(
  ...args: Parameters<typeof actions.createArtObject>
) {
  return value(actions.createArtObject(...args));
}

export async function updateArtObject(
  ...args: Parameters<typeof actions.updateArtObject>
) {
  return value(actions.updateArtObject(...args));
}

export async function deleteArtObject(
  ...args: Parameters<typeof actions.deleteArtObject>
) {
  return value(actions.deleteArtObject(...args));
}

export async function createPerfumeVariant(
  ...args: Parameters<typeof actions.createPerfumeVariant>
) {
  return value(actions.createPerfumeVariant(...args));
}

export async function updatePerfumeVariant(
  ...args: Parameters<typeof actions.updatePerfumeVariant>
) {
  return value(actions.updatePerfumeVariant(...args));
}

export async function deletePerfumeVariant(
  ...args: Parameters<typeof actions.deletePerfumeVariant>
) {
  return value(actions.deletePerfumeVariant(...args));
}

export async function addPerfumeRetailerLink(
  ...args: Parameters<typeof actions.addPerfumeRetailerLink>
) {
  return value(actions.addPerfumeRetailerLink(...args));
}

export async function recordRetailerObservation(
  ...args: Parameters<typeof actions.recordRetailerObservation>
) {
  return value(actions.recordRetailerObservation(...args));
}

export async function archivePerfumeRetailerLink(
  ...args: Parameters<typeof actions.archivePerfumeRetailerLink>
) {
  return value(actions.archivePerfumeRetailerLink(...args));
}

export async function deletePerfumeRetailerLink(
  ...args: Parameters<typeof actions.deletePerfumeRetailerLink>
) {
  return value(actions.deletePerfumeRetailerLink(...args));
}

export async function createTypedTarget(
  ...args: Parameters<typeof actions.createTypedTarget>
) {
  return value(actions.createTypedTarget(...args));
}

export async function orderTypedTarget(
  ...args: Parameters<typeof actions.orderTypedTarget>
) {
  return value(actions.orderTypedTarget(...args));
}

export async function removeTypedTarget(
  ...args: Parameters<typeof actions.removeTypedTarget>
) {
  return value(actions.removeTypedTarget(...args));
}

export async function savePublisher(
  ...args: Parameters<typeof actions.savePublisher>
) {
  return value(actions.savePublisher(...args));
}

export async function createAcquisitionTarget(
  ...args: Parameters<typeof actions.createAcquisitionTarget>
) {
  return value(actions.createAcquisitionTarget(...args));
}

export async function cancelAcquisitionTarget(
  ...args: Parameters<typeof actions.cancelAcquisitionTarget>
) {
  return value(actions.cancelAcquisitionTarget(...args));
}

export async function fulfilTargetWithCopy(
  ...args: Parameters<typeof actions.fulfilTargetWithCopy>
) {
  return value(actions.fulfilTargetWithCopy(...args));
}

export async function startReading(
  ...args: Parameters<typeof actions.startReading>
) {
  return value(actions.startReading(...args));
}

export async function logProgress(
  ...args: Parameters<typeof actions.logProgress>
) {
  return value(actions.logProgress(...args));
}

export async function startTimer(
  ...args: Parameters<typeof actions.startTimer>
) {
  return value(actions.startTimer(...args));
}

export async function pauseTimer(
  ...args: Parameters<typeof actions.pauseTimer>
) {
  return value(actions.pauseTimer(...args));
}

export async function resumeTimer(
  ...args: Parameters<typeof actions.resumeTimer>
) {
  return value(actions.resumeTimer(...args));
}

export async function stopTimer(...args: Parameters<typeof actions.stopTimer>) {
  return value(actions.stopTimer(...args));
}

export async function undoStopTimer(
  ...args: Parameters<typeof actions.undoStopTimer>
) {
  return value(actions.undoStopTimer(...args));
}

export async function discardTimer(
  ...args: Parameters<typeof actions.discardTimer>
) {
  return value(actions.discardTimer(...args));
}

export async function undoProgress(
  ...args: Parameters<typeof actions.undoProgress>
) {
  return value(actions.undoProgress(...args));
}

export async function pauseReading(
  ...args: Parameters<typeof actions.pauseReading>
) {
  return value(actions.pauseReading(...args));
}

export async function resumeReading(
  ...args: Parameters<typeof actions.resumeReading>
) {
  return value(actions.resumeReading(...args));
}

export async function finishReading(
  ...args: Parameters<typeof actions.finishReading>
) {
  return value(actions.finishReading(...args));
}

export async function abandonReading(
  ...args: Parameters<typeof actions.abandonReading>
) {
  return value(actions.abandonReading(...args));
}

export async function reopenReading(
  ...args: Parameters<typeof actions.reopenReading>
) {
  return value(actions.reopenReading(...args));
}

export async function addPastReading(
  ...args: Parameters<typeof actions.addPastReading>
) {
  return value(actions.addPastReading(...args));
}

export async function updateReading(
  ...args: Parameters<typeof actions.updateReading>
) {
  return value(actions.updateReading(...args));
}

export async function deleteReading(
  ...args: Parameters<typeof actions.deleteReading>
) {
  return value(actions.deleteReading(...args));
}

export async function restoreReading(
  ...args: Parameters<typeof actions.restoreReading>
) {
  return value(actions.restoreReading(...args));
}

export async function updateSession(
  ...args: Parameters<typeof actions.updateSession>
) {
  return value(actions.updateSession(...args));
}

export async function addSession(
  ...args: Parameters<typeof actions.addSession>
) {
  return value(actions.addSession(...args));
}

export async function restoreSession(
  ...args: Parameters<typeof actions.restoreSession>
) {
  return value(actions.restoreSession(...args));
}

export async function deleteSession(
  ...args: Parameters<typeof actions.deleteSession>
) {
  return value(actions.deleteSession(...args));
}

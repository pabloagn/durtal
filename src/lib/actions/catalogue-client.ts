"use client";

import * as actions from "./catalogue-ui";
import type { ActionResult } from "./action-result";
import { ActionRefusal } from "./action-refusal";

/** Next's redirect, which the router follows on its own */
const isRedirect = (error: unknown) =>
  typeof error === "object" && error !== null && typeof (error as { digest?: unknown }).digest === "string" && (error as { digest: string }).digest.startsWith("NEXT_REDIRECT;");

/**
 * A delete from the record's page: null once its action redirected to the
 * list (SLN-1330), else the outcome the page must still report. The router
 * goes to the list with the response it already has.
 */
async function leaving<T>(result: Promise<ActionResult<T>>): Promise<T | null> {
  try {
    return await value(result);
  } catch (error) {
    if (isRedirect(error)) return null;
    throw error;
  }
}

/** Unwrap on the client, after the deliberate refusal crossed as data. */
async function value<T>(result: Promise<ActionResult<T>>): Promise<T> {
  const outcome = await result;
  if (!outcome.ok) throw new ActionRefusal(outcome.error, outcome.href);
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

export async function createAuthor(
  ...args: Parameters<typeof actions.createAuthor>
) {
  return value(actions.createAuthor(...args));
}

export async function deleteAuthor(
  ...args: Parameters<typeof actions.deleteAuthor>
) {
  return value(actions.deleteAuthor(...args));
}

export async function mergeAuthors(
  ...args: Parameters<typeof actions.mergeAuthors>
) {
  return value(actions.mergeAuthors(...args));
}

export async function updateAuthor(
  ...args: Parameters<typeof actions.updateAuthor>
) {
  return value(actions.updateAuthor(...args));
}

export async function citeSource(
  ...args: Parameters<typeof actions.citeSource>
) {
  return value(actions.citeSource(...args));
}

export async function deleteCitedSource(
  ...args: Parameters<typeof actions.deleteCitedSource>
) {
  return value(actions.deleteCitedSource(...args));
}

export async function addToCollection(
  ...args: Parameters<typeof actions.addToCollection>
) {
  return value(actions.addToCollection(...args));
}

export async function createCollection(
  ...args: Parameters<typeof actions.createCollection>
) {
  return value(actions.createCollection(...args));
}

export async function deleteCollection(
  ...args: Parameters<typeof actions.deleteCollection>
) {
  return value(actions.deleteCollection(...args));
}

export async function moveCollectionMember(
  ...args: Parameters<typeof actions.moveCollectionMember>
) {
  return value(actions.moveCollectionMember(...args));
}

export async function removeEditionFromCollection(
  ...args: Parameters<typeof actions.removeEditionFromCollection>
) {
  return value(actions.removeEditionFromCollection(...args));
}

export async function removeFromCollection(
  ...args: Parameters<typeof actions.removeFromCollection>
) {
  return value(actions.removeFromCollection(...args));
}

export async function removeWorksFromCollection(
  ...args: Parameters<typeof actions.removeWorksFromCollection>
) {
  return value(actions.removeWorksFromCollection(...args));
}

export async function setCollectionIcon(
  ...args: Parameters<typeof actions.setCollectionIcon>
) {
  return value(actions.setCollectionIcon(...args));
}

export async function updateCollection(
  ...args: Parameters<typeof actions.updateCollection>
) {
  return value(actions.updateCollection(...args));
}

export async function updateWorkCuration(
  ...args: Parameters<typeof actions.updateWorkCuration>
) {
  return value(actions.updateWorkCuration(...args));
}

export async function createEdition(
  ...args: Parameters<typeof actions.createEdition>
) {
  return value(actions.createEdition(...args));
}

export async function deleteEdition(
  ...args: Parameters<typeof actions.deleteEdition>
) {
  return value(actions.deleteEdition(...args));
}

export async function updateEdition(
  ...args: Parameters<typeof actions.updateEdition>
) {
  return value(actions.updateEdition(...args));
}

export async function setFavourite(
  ...args: Parameters<typeof actions.setFavourite>
) {
  return value(actions.setFavourite(...args));
}

export async function setFavourites(
  ...args: Parameters<typeof actions.setFavourites>
) {
  return value(actions.setFavourites(...args));
}






export async function bulkUpdateHuntAssessment(
  ...args: Parameters<typeof actions.bulkUpdateHuntAssessment>
) {
  return value(actions.bulkUpdateHuntAssessment(...args));
}

export async function updateHuntAssessment(
  ...args: Parameters<typeof actions.updateHuntAssessment>
) {
  return value(actions.updateHuntAssessment(...args));
}

export async function identifyEdition(
  ...args: Parameters<typeof actions.identifyEdition>
) {
  return value(actions.identifyEdition(...args));
}

export async function keepWithoutIsbn(
  ...args: Parameters<typeof actions.keepWithoutIsbn>
) {
  return value(actions.keepWithoutIsbn(...args));
}

export async function moveToExistingEdition(
  ...args: Parameters<typeof actions.moveToExistingEdition>
) {
  return value(actions.moveToExistingEdition(...args));
}

export async function undoIdentification(
  ...args: Parameters<typeof actions.undoIdentification>
) {
  return value(actions.undoIdentification(...args));
}

export async function saveImagePresentation(
  ...args: Parameters<typeof actions.saveImagePresentation>
) {
  return value(actions.saveImagePresentation(...args));
}

export async function createInstance(
  ...args: Parameters<typeof actions.createInstance>
) {
  return value(actions.createInstance(...args));
}

export async function deleteInstance(
  ...args: Parameters<typeof actions.deleteInstance>
) {
  return value(actions.deleteInstance(...args));
}

export async function updateInstance(
  ...args: Parameters<typeof actions.updateInstance>
) {
  return value(actions.updateInstance(...args));
}

export async function createLocation(
  ...args: Parameters<typeof actions.createLocation>
) {
  return value(actions.createLocation(...args));
}

export async function deleteLocation(
  ...args: Parameters<typeof actions.deleteLocation>
) {
  return value(actions.deleteLocation(...args));
}

export async function updateLocation(
  ...args: Parameters<typeof actions.updateLocation>
) {
  return value(actions.updateLocation(...args));
}

export async function bulkDeleteMedia(
  ...args: Parameters<typeof actions.bulkDeleteMedia>
) {
  return value(actions.bulkDeleteMedia(...args));
}

export async function deleteMedia(
  ...args: Parameters<typeof actions.deleteMedia>
) {
  return value(actions.deleteMedia(...args));
}

export async function setActiveMedia(
  ...args: Parameters<typeof actions.setActiveMedia>
) {
  return value(actions.setActiveMedia(...args));
}

export async function updateMediaDetails(
  ...args: Parameters<typeof actions.updateMediaDetails>
) {
  return value(actions.updateMediaDetails(...args));
}

export async function createOrder(
  ...args: Parameters<typeof actions.createOrder>
) {
  return value(actions.createOrder(...args));
}

export async function createOrderForNewBook(
  ...args: Parameters<typeof actions.createOrderForNewBook>
) {
  return value(actions.createOrderForNewBook(...args));
}

export async function deleteOrder(
  ...args: Parameters<typeof actions.deleteOrder>
) {
  return value(actions.deleteOrder(...args));
}

export async function updateOrder(
  ...args: Parameters<typeof actions.updateOrder>
) {
  return value(actions.updateOrder(...args));
}

export async function updateOrderStatus(
  ...args: Parameters<typeof actions.updateOrderStatus>
) {
  return value(actions.updateOrderStatus(...args));
}

export async function addOrganization(
  ...args: Parameters<typeof actions.addOrganization>
) {
  return value(actions.addOrganization(...args));
}

export async function removeOrganization(
  ...args: Parameters<typeof actions.removeOrganization>
) {
  return value(actions.removeOrganization(...args));
}

export async function updateOrganizationProfile(
  ...args: Parameters<typeof actions.updateOrganizationProfile>
) {
  return value(actions.updateOrganizationProfile(...args));
}

export async function saveOrganization(
  ...args: Parameters<typeof actions.saveOrganization>
) {
  return value(actions.saveOrganization(...args));
}

export async function createPerson(
  ...args: Parameters<typeof actions.createPerson>
) {
  return value(actions.createPerson(...args));
}

export async function createPlace(
  ...args: Parameters<typeof actions.createPlace>
) {
  return value(actions.createPlace(...args));
}

export async function createPlaceFromGeocode(
  ...args: Parameters<typeof actions.createPlaceFromGeocode>
) {
  return value(actions.createPlaceFromGeocode(...args));
}

export async function bulkSetPoison(
  ...args: Parameters<typeof actions.bulkSetPoison>
) {
  return value(actions.bulkSetPoison(...args));
}

export async function setPoison(
  ...args: Parameters<typeof actions.setPoison>
) {
  return value(actions.setPoison(...args));
}

export async function createPublisherFromName(
  ...args: Parameters<typeof actions.createPublisherFromName>
) {
  return value(actions.createPublisherFromName(...args));
}

export async function resetEditionPublisherLinks(
  ...args: Parameters<typeof actions.resetEditionPublisherLinks>
) {
  return value(actions.resetEditionPublisherLinks(...args));
}

export async function setEditionPublisherLinks(
  ...args: Parameters<typeof actions.setEditionPublisherLinks>
) {
  return value(actions.setEditionPublisherLinks(...args));
}

export async function removeReadingGoal(
  ...args: Parameters<typeof actions.removeReadingGoal>
) {
  return value(actions.removeReadingGoal(...args));
}

export async function setReadingGoal(
  ...args: Parameters<typeof actions.setReadingGoal>
) {
  return value(actions.setReadingGoal(...args));
}

export async function createReadingNote(
  ...args: Parameters<typeof actions.createReadingNote>
) {
  return value(actions.createReadingNote(...args));
}

export async function deleteReadingNote(
  ...args: Parameters<typeof actions.deleteReadingNote>
) {
  return value(actions.deleteReadingNote(...args));
}

export async function restoreReadingNote(
  ...args: Parameters<typeof actions.restoreReadingNote>
) {
  return value(actions.restoreReadingNote(...args));
}

export async function toggleNoteFavourite(
  ...args: Parameters<typeof actions.toggleNoteFavourite>
) {
  return value(actions.toggleNoteFavourite(...args));
}

export async function updateReadingNote(
  ...args: Parameters<typeof actions.updateReadingNote>
) {
  return value(actions.updateReadingNote(...args));
}

export async function addManyToQueue(
  ...args: Parameters<typeof actions.addManyToQueue>
) {
  return value(actions.addManyToQueue(...args));
}

export async function addToQueue(
  ...args: Parameters<typeof actions.addToQueue>
) {
  return value(actions.addToQueue(...args));
}

export async function moveQueueItem(
  ...args: Parameters<typeof actions.moveQueueItem>
) {
  return value(actions.moveQueueItem(...args));
}

export async function removeFromQueue(
  ...args: Parameters<typeof actions.removeFromQueue>
) {
  return value(actions.removeFromQueue(...args));
}

export async function restoreQueueItem(
  ...args: Parameters<typeof actions.restoreQueueItem>
) {
  return value(actions.restoreQueueItem(...args));
}

export async function createRecommender(
  ...args: Parameters<typeof actions.createRecommender>
) {
  return value(actions.createRecommender(...args));
}

export async function deleteRecommender(
  ...args: Parameters<typeof actions.deleteRecommender>
) {
  return value(actions.deleteRecommender(...args));
}

export async function updateRecommender(
  ...args: Parameters<typeof actions.updateRecommender>
) {
  return value(actions.updateRecommender(...args));
}

export async function addWorksToSeries(
  ...args: Parameters<typeof actions.addWorksToSeries>
) {
  return value(actions.addWorksToSeries(...args));
}

export async function createSeries(
  ...args: Parameters<typeof actions.createSeries>
) {
  return value(actions.createSeries(...args));
}

export async function deleteSeries(
  ...args: Parameters<typeof actions.deleteSeries>
) {
  return value(actions.deleteSeries(...args));
}

export async function removeWorkFromSeries(
  ...args: Parameters<typeof actions.removeWorkFromSeries>
) {
  return value(actions.removeWorkFromSeries(...args));
}

export async function setSeriesPosition(
  ...args: Parameters<typeof actions.setSeriesPosition>
) {
  return value(actions.setSeriesPosition(...args));
}

export async function updateSeries(
  ...args: Parameters<typeof actions.updateSeries>
) {
  return value(actions.updateSeries(...args));
}

export async function removeSuggestionFeedback(
  ...args: Parameters<typeof actions.removeSuggestionFeedback>
) {
  return value(actions.removeSuggestionFeedback(...args));
}

export async function restoreSuggestionFeedback(
  ...args: Parameters<typeof actions.restoreSuggestionFeedback>
) {
  return value(actions.restoreSuggestionFeedback(...args));
}

export async function setSuggestionFeedback(
  ...args: Parameters<typeof actions.setSuggestionFeedback>
) {
  return value(actions.setSuggestionFeedback(...args));
}

export async function updateWorkTaxonomy(
  ...args: Parameters<typeof actions.updateWorkTaxonomy>
) {
  return value(actions.updateWorkTaxonomy(...args));
}

export async function linkVenueInstitution(
  ...args: Parameters<typeof actions.linkVenueInstitution>
) {
  return value(actions.linkVenueInstitution(...args));
}

export async function removeVenue(
  ...args: Parameters<typeof actions.removeVenue>
) {
  return value(actions.removeVenue(...args));
}

export async function setVenueArchived(
  ...args: Parameters<typeof actions.setVenueArchived>
) {
  return value(actions.setVenueArchived(...args));
}

export async function unlinkVenueInstitution(
  ...args: Parameters<typeof actions.unlinkVenueInstitution>
) {
  return value(actions.unlinkVenueInstitution(...args));
}

export async function createVenue(
  ...args: Parameters<typeof actions.createVenue>
) {
  return value(actions.createVenue(...args));
}

export async function updateVenue(
  ...args: Parameters<typeof actions.updateVenue>
) {
  return value(actions.updateVenue(...args));
}

export async function deleteWhereabouts(
  ...args: Parameters<typeof actions.deleteWhereabouts>
) {
  return value(actions.deleteWhereabouts(...args));
}

export async function recordWhereabouts(
  ...args: Parameters<typeof actions.recordWhereabouts>
) {
  return value(actions.recordWhereabouts(...args));
}

export async function updateWhereabouts(
  ...args: Parameters<typeof actions.updateWhereabouts>
) {
  return value(actions.updateWhereabouts(...args));
}

export async function verifyWhereabouts(
  ...args: Parameters<typeof actions.verifyWhereabouts>
) {
  return value(actions.verifyWhereabouts(...args));
}

export async function createWorkRelation(
  ...args: Parameters<typeof actions.createWorkRelation>
) {
  return value(actions.createWorkRelation(...args));
}

export async function deleteWorkRelation(
  ...args: Parameters<typeof actions.deleteWorkRelation>
) {
  return value(actions.deleteWorkRelation(...args));
}

export async function deleteWork(
  ...args: Parameters<typeof actions.deleteWork>
) {
  return value(actions.deleteWork(...args));
}

export async function updateWork(
  ...args: Parameters<typeof actions.updateWork>
) {
  return value(actions.updateWork(...args));
}

export async function findEditionCandidates(
  ...args: Parameters<typeof actions.findEditionCandidates>
) {
  return value(actions.findEditionCandidates(...args));
}

export async function previewMatch(
  ...args: Parameters<typeof actions.previewMatch>
) {
  return value(actions.previewMatch(...args));
}

export async function applyMatch(
  ...args: Parameters<typeof actions.applyMatch>
) {
  return value(actions.applyMatch(...args));
}

export async function resolvePublisherNames(
  ...args: Parameters<typeof actions.resolvePublisherNames>
) {
  return value(actions.resolvePublisherNames(...args));
}

export async function applySafePublisherDecisions(
  ...args: Parameters<typeof actions.applySafePublisherDecisions>
) {
  return value(actions.applySafePublisherDecisions(...args));
}

export async function restorePublisherName(
  ...args: Parameters<typeof actions.restorePublisherName>
) {
  return value(actions.restorePublisherName(...args));
}

export async function undoAutomaticPublisherDecision(
  ...args: Parameters<typeof actions.undoAutomaticPublisherDecision>
) {
  return value(actions.undoAutomaticPublisherDecision(...args));
}

export async function findPageCount(
  ...args: Parameters<typeof actions.findPageCount>
) {
  return value(actions.findPageCount(...args));
}

export async function markWorksRead(
  ...args: Parameters<typeof actions.markWorksRead>
) {
  return value(actions.markWorksRead(...args));
}

export async function undoMarkWorksRead(
  ...args: Parameters<typeof actions.undoMarkWorksRead>
) {
  return value(actions.undoMarkWorksRead(...args));
}

export async function createFilm(
  ...args: Parameters<typeof actions.createFilm>
) {
  return value(actions.createFilm(...args));
}

export async function updateFilm(
  ...args: Parameters<typeof actions.updateFilm>
) {
  return value(actions.updateFilm(...args));
}

export async function deleteFilm(
  ...args: Parameters<typeof actions.deleteFilm>
) {
  return value(actions.deleteFilm(...args));
}

export async function addFilmHolding(
  ...args: Parameters<typeof actions.addFilmHolding>
) {
  return value(actions.addFilmHolding(...args));
}

export async function updateFilmHolding(
  ...args: Parameters<typeof actions.updateFilmHolding>
) {
  return value(actions.updateFilmHolding(...args));
}

export async function deleteFilmHolding(
  ...args: Parameters<typeof actions.deleteFilmHolding>
) {
  return value(actions.deleteFilmHolding(...args));
}

export async function createPainting(
  ...args: Parameters<typeof actions.createPainting>
) {
  return value(actions.createPainting(...args));
}

export async function updatePainting(
  ...args: Parameters<typeof actions.updatePainting>
) {
  return value(actions.updatePainting(...args));
}

export async function deletePainting(
  ...args: Parameters<typeof actions.deletePainting>
) {
  return value(actions.deletePainting(...args));
}

export async function createPerfume(
  ...args: Parameters<typeof actions.createPerfume>
) {
  return value(actions.createPerfume(...args));
}

export async function updatePerfume(
  ...args: Parameters<typeof actions.updatePerfume>
) {
  return value(actions.updatePerfume(...args));
}

export async function deletePerfume(
  ...args: Parameters<typeof actions.deletePerfume>
) {
  return value(actions.deletePerfume(...args));
}

export async function addPerfumeBottle(
  ...args: Parameters<typeof actions.addPerfumeBottle>
) {
  return value(actions.addPerfumeBottle(...args));
}

export async function updatePerfumeBottle(
  ...args: Parameters<typeof actions.updatePerfumeBottle>
) {
  return value(actions.updatePerfumeBottle(...args));
}

export async function deletePerfumeBottle(
  ...args: Parameters<typeof actions.deletePerfumeBottle>
) {
  return value(actions.deletePerfumeBottle(...args));
}

export async function findOrCreateAuthor(
  ...args: Parameters<typeof actions.findOrCreateAuthor>
) {
  return value(actions.findOrCreateAuthor(...args));
}

export async function deleteCollectionFromPage(id: string) {
  return leaving(actions.deleteCollectionFromPage(id));
}

export async function deleteFilmFromPage(id: string) {
  return leaving(actions.deleteFilmFromPage(id));
}

export async function deleteWorkFromPage(id: string) {
  return leaving(actions.deleteWorkFromPage(id));
}

export async function removeOrganizationFromPage(id: string) {
  return leaving(actions.removeOrganizationFromPage(id));
}

export async function deletePaintingFromPage(id: string) {
  return leaving(actions.deletePaintingFromPage(id));
}

export async function deleteAuthorFromPage(id: string) {
  return leaving(actions.deleteAuthorFromPage(id));
}

export async function deletePerfumeFromPage(id: string) {
  return leaving(actions.deletePerfumeFromPage(id));
}

export async function removeVenueFromPage(id: string) {
  return leaving(actions.removeVenueFromPage(id));
}

export async function deleteRecommenderFromPage(id: string) {
  return leaving(actions.deleteRecommenderFromPage(id));
}

export async function deleteSeriesFromPage(id: string) {
  return leaving(actions.deleteSeriesFromPage(id));
}

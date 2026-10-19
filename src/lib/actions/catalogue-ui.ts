"use server";

import { RedirectType, redirect } from "next/navigation";
import { actionResult } from "./action-result";
import * as films from "./films";
import * as paintings from "./paintings";
import * as perfumes from "./perfumes";
import * as perfume_retailers from "./perfume-retailers";
import * as acquisitions from "./acquisitions";
import * as publishers from "./publishers";
import * as reading from "./reading";
import * as authors from "./authors";
import * as catalogue_provenance from "./catalogue-provenance";
import * as collections from "./collections";
import * as curation from "./curation";
import * as editions from "./editions";
import * as favourites from "./favourites";
import * as hunting from "./hunting";
import * as identify from "./identify";
import * as match from "./match";
import * as image_adjustments from "./image-adjustments";
import * as instances from "./instances";
import * as locations from "./locations";
import * as media from "./media";
import * as orders from "./orders";
import * as organization_directory from "./organization-directory";
import * as organizations from "./organizations";
import * as people from "./people";
import * as places from "./places";
import * as publisher_names from "./publisher-names";
import * as poison from "./poison";
import * as reading_bulk from "./reading-bulk";
import * as reading_goals from "./reading-goals";
import * as reading_import from "./reading-import";
import * as reading_notes from "./reading-notes";
import * as reading_queue from "./reading-queue";
import * as recommenders from "./recommenders";
import * as series from "./series";
import * as suggestions from "./suggestions";
import * as taxonomy from "./taxonomy";
import * as venue_pages from "./venue-pages";
import * as venues from "./venues";
import * as whereabouts from "./whereabouts";
import * as work_relations from "./work-relations";
import * as works from "./works";

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

// Writes with deliberate refusals elsewhere in the catalogue and reading
// (SLN-1033): their reason reaches the screen, as the ones above do.

export async function createAuthor(
  ...args: Parameters<typeof authors.createAuthor>
) {
  return actionResult(() => authors.createAuthor(...args));
}

export async function deleteAuthor(
  ...args: Parameters<typeof authors.deleteAuthor>
) {
  return actionResult(() => authors.deleteAuthor(...args));
}

export async function mergeAuthors(
  ...args: Parameters<typeof authors.mergeAuthors>
) {
  return actionResult(() => authors.mergeAuthors(...args));
}

export async function updateAuthor(
  ...args: Parameters<typeof authors.updateAuthor>
) {
  return actionResult(() => authors.updateAuthor(...args));
}

export async function citeSource(
  ...args: Parameters<typeof catalogue_provenance.citeSource>
) {
  return actionResult(() => catalogue_provenance.citeSource(...args));
}

export async function deleteCitedSource(
  ...args: Parameters<typeof catalogue_provenance.deleteCitedSource>
) {
  return actionResult(() => catalogue_provenance.deleteCitedSource(...args));
}

export async function addToCollection(
  ...args: Parameters<typeof collections.addToCollection>
) {
  return actionResult(() => collections.addToCollection(...args));
}

export async function createCollection(
  ...args: Parameters<typeof collections.createCollection>
) {
  return actionResult(() => collections.createCollection(...args));
}

export async function deleteCollection(
  ...args: Parameters<typeof collections.deleteCollection>
) {
  return actionResult(() => collections.deleteCollection(...args));
}

export async function moveCollectionMember(
  ...args: Parameters<typeof collections.moveCollectionMember>
) {
  return actionResult(() => collections.moveCollectionMember(...args));
}

export async function removeEditionFromCollection(
  ...args: Parameters<typeof collections.removeEditionFromCollection>
) {
  return actionResult(() => collections.removeEditionFromCollection(...args));
}

export async function removeFromCollection(
  ...args: Parameters<typeof collections.removeFromCollection>
) {
  return actionResult(() => collections.removeFromCollection(...args));
}

export async function removeWorksFromCollection(
  ...args: Parameters<typeof collections.removeWorksFromCollection>
) {
  return actionResult(() => collections.removeWorksFromCollection(...args));
}

export async function setCollectionIcon(
  ...args: Parameters<typeof collections.setCollectionIcon>
) {
  return actionResult(() => collections.setCollectionIcon(...args));
}

export async function updateCollection(
  ...args: Parameters<typeof collections.updateCollection>
) {
  return actionResult(() => collections.updateCollection(...args));
}

export async function updateWorkCuration(
  ...args: Parameters<typeof curation.updateWorkCuration>
) {
  return actionResult(() => curation.updateWorkCuration(...args));
}

export async function createEdition(
  ...args: Parameters<typeof editions.createEdition>
) {
  return actionResult(() => editions.createEdition(...args));
}

export async function deleteEdition(
  ...args: Parameters<typeof editions.deleteEdition>
) {
  return actionResult(() => editions.deleteEdition(...args));
}

export async function updateEdition(
  ...args: Parameters<typeof editions.updateEdition>
) {
  return actionResult(() => editions.updateEdition(...args));
}

export async function setFavourite(
  ...args: Parameters<typeof favourites.setFavourite>
) {
  return actionResult(() => favourites.setFavourite(...args));
}

export async function setFavourites(
  ...args: Parameters<typeof favourites.setFavourites>
) {
  return actionResult(() => favourites.setFavourites(...args));
}






export async function bulkUpdateHuntAssessment(
  ...args: Parameters<typeof hunting.bulkUpdateHuntAssessment>
) {
  return actionResult(() => hunting.bulkUpdateHuntAssessment(...args));
}

export async function updateHuntAssessment(
  ...args: Parameters<typeof hunting.updateHuntAssessment>
) {
  return actionResult(() => hunting.updateHuntAssessment(...args));
}

export async function identifyEdition(
  ...args: Parameters<typeof identify.identifyEdition>
) {
  return actionResult(() => identify.identifyEdition(...args));
}

export async function keepWithoutIsbn(
  ...args: Parameters<typeof identify.keepWithoutIsbn>
) {
  return actionResult(() => identify.keepWithoutIsbn(...args));
}

export async function moveToExistingEdition(
  ...args: Parameters<typeof identify.moveToExistingEdition>
) {
  return actionResult(() => identify.moveToExistingEdition(...args));
}

export async function undoIdentification(
  ...args: Parameters<typeof identify.undoIdentification>
) {
  return actionResult(() => identify.undoIdentification(...args));
}

export async function saveImagePresentation(
  ...args: Parameters<typeof image_adjustments.saveImagePresentation>
) {
  return actionResult(() => image_adjustments.saveImagePresentation(...args));
}

export async function createInstance(
  ...args: Parameters<typeof instances.createInstance>
) {
  return actionResult(() => instances.createInstance(...args));
}

export async function deleteInstance(
  ...args: Parameters<typeof instances.deleteInstance>
) {
  return actionResult(() => instances.deleteInstance(...args));
}

export async function updateInstance(
  ...args: Parameters<typeof instances.updateInstance>
) {
  return actionResult(() => instances.updateInstance(...args));
}

export async function createLocation(
  ...args: Parameters<typeof locations.createLocation>
) {
  return actionResult(() => locations.createLocation(...args));
}

export async function deleteLocation(
  ...args: Parameters<typeof locations.deleteLocation>
) {
  return actionResult(() => locations.deleteLocation(...args));
}

export async function updateLocation(
  ...args: Parameters<typeof locations.updateLocation>
) {
  return actionResult(() => locations.updateLocation(...args));
}

export async function bulkDeleteMedia(
  ...args: Parameters<typeof media.bulkDeleteMedia>
) {
  return actionResult(() => media.bulkDeleteMedia(...args));
}

export async function deleteMedia(
  ...args: Parameters<typeof media.deleteMedia>
) {
  return actionResult(() => media.deleteMedia(...args));
}

export async function setActiveMedia(
  ...args: Parameters<typeof media.setActiveMedia>
) {
  return actionResult(() => media.setActiveMedia(...args));
}

export async function updateMediaDetails(
  ...args: Parameters<typeof media.updateMediaDetails>
) {
  return actionResult(() => media.updateMediaDetails(...args));
}

export async function createOrder(
  ...args: Parameters<typeof orders.createOrder>
) {
  return actionResult(() => orders.createOrder(...args));
}

export async function createOrderForNewBook(
  ...args: Parameters<typeof orders.createOrderForNewBook>
) {
  return actionResult(() => orders.createOrderForNewBook(...args));
}

export async function deleteOrder(
  ...args: Parameters<typeof orders.deleteOrder>
) {
  return actionResult(() => orders.deleteOrder(...args));
}

export async function updateOrder(
  ...args: Parameters<typeof orders.updateOrder>
) {
  return actionResult(() => orders.updateOrder(...args));
}

export async function updateOrderStatus(
  ...args: Parameters<typeof orders.updateOrderStatus>
) {
  return actionResult(() => orders.updateOrderStatus(...args));
}

export async function addOrganization(
  ...args: Parameters<typeof organization_directory.addOrganization>
) {
  return actionResult(() => organization_directory.addOrganization(...args));
}

export async function removeOrganization(
  ...args: Parameters<typeof organization_directory.removeOrganization>
) {
  return actionResult(() => organization_directory.removeOrganization(...args));
}

export async function updateOrganizationProfile(
  ...args: Parameters<typeof organization_directory.updateOrganizationProfile>
) {
  return actionResult(() => organization_directory.updateOrganizationProfile(...args));
}

export async function saveOrganization(
  ...args: Parameters<typeof organizations.saveOrganization>
) {
  return actionResult(() => organizations.saveOrganization(...args));
}

export async function createPerson(
  ...args: Parameters<typeof people.createPerson>
) {
  return actionResult(() => people.createPerson(...args));
}

export async function createPlace(
  ...args: Parameters<typeof places.createPlace>
) {
  return actionResult(() => places.createPlace(...args));
}

export async function createPlaceFromGeocode(
  ...args: Parameters<typeof places.createPlaceFromGeocode>
) {
  return actionResult(() => places.createPlaceFromGeocode(...args));
}

export async function bulkSetPoison(
  ...args: Parameters<typeof poison.bulkSetPoison>
) {
  return actionResult(() => poison.bulkSetPoison(...args));
}

export async function setPoison(
  ...args: Parameters<typeof poison.setPoison>
) {
  return actionResult(() => poison.setPoison(...args));
}

export async function createPublisherFromName(
  ...args: Parameters<typeof publishers.createPublisherFromName>
) {
  return actionResult(() => publishers.createPublisherFromName(...args));
}

export async function resetEditionPublisherLinks(
  ...args: Parameters<typeof publishers.resetEditionPublisherLinks>
) {
  return actionResult(() => publishers.resetEditionPublisherLinks(...args));
}

export async function setEditionPublisherLinks(
  ...args: Parameters<typeof publishers.setEditionPublisherLinks>
) {
  return actionResult(() => publishers.setEditionPublisherLinks(...args));
}

export async function removeReadingGoal(
  ...args: Parameters<typeof reading_goals.removeReadingGoal>
) {
  return actionResult(() => reading_goals.removeReadingGoal(...args));
}

export async function setReadingGoal(
  ...args: Parameters<typeof reading_goals.setReadingGoal>
) {
  return actionResult(() => reading_goals.setReadingGoal(...args));
}

export async function createReadingNote(
  ...args: Parameters<typeof reading_notes.createReadingNote>
) {
  return actionResult(() => reading_notes.createReadingNote(...args));
}

export async function deleteReadingNote(
  ...args: Parameters<typeof reading_notes.deleteReadingNote>
) {
  return actionResult(() => reading_notes.deleteReadingNote(...args));
}

export async function restoreReadingNote(
  ...args: Parameters<typeof reading_notes.restoreReadingNote>
) {
  return actionResult(() => reading_notes.restoreReadingNote(...args));
}

export async function toggleNoteFavourite(
  ...args: Parameters<typeof reading_notes.toggleNoteFavourite>
) {
  return actionResult(() => reading_notes.toggleNoteFavourite(...args));
}

export async function updateReadingNote(
  ...args: Parameters<typeof reading_notes.updateReadingNote>
) {
  return actionResult(() => reading_notes.updateReadingNote(...args));
}

export async function addManyToQueue(
  ...args: Parameters<typeof reading_queue.addManyToQueue>
) {
  return actionResult(() => reading_queue.addManyToQueue(...args));
}

export async function addToQueue(
  ...args: Parameters<typeof reading_queue.addToQueue>
) {
  return actionResult(() => reading_queue.addToQueue(...args));
}

export async function moveQueueItem(
  ...args: Parameters<typeof reading_queue.moveQueueItem>
) {
  return actionResult(() => reading_queue.moveQueueItem(...args));
}

export async function removeFromQueue(
  ...args: Parameters<typeof reading_queue.removeFromQueue>
) {
  return actionResult(() => reading_queue.removeFromQueue(...args));
}

export async function restoreQueueItem(
  ...args: Parameters<typeof reading_queue.restoreQueueItem>
) {
  return actionResult(() => reading_queue.restoreQueueItem(...args));
}

export async function createRecommender(
  ...args: Parameters<typeof recommenders.createRecommender>
) {
  return actionResult(() => recommenders.createRecommender(...args));
}

export async function deleteRecommender(
  ...args: Parameters<typeof recommenders.deleteRecommender>
) {
  return actionResult(() => recommenders.deleteRecommender(...args));
}

export async function updateRecommender(
  ...args: Parameters<typeof recommenders.updateRecommender>
) {
  return actionResult(() => recommenders.updateRecommender(...args));
}

export async function addWorksToSeries(
  ...args: Parameters<typeof series.addWorksToSeries>
) {
  return actionResult(() => series.addWorksToSeries(...args));
}

export async function createSeries(
  ...args: Parameters<typeof series.createSeries>
) {
  return actionResult(() => series.createSeries(...args));
}

export async function deleteSeries(
  ...args: Parameters<typeof series.deleteSeries>
) {
  return actionResult(() => series.deleteSeries(...args));
}

export async function removeWorkFromSeries(
  ...args: Parameters<typeof series.removeWorkFromSeries>
) {
  return actionResult(() => series.removeWorkFromSeries(...args));
}

export async function setSeriesPosition(
  ...args: Parameters<typeof series.setSeriesPosition>
) {
  return actionResult(() => series.setSeriesPosition(...args));
}

export async function updateSeries(
  ...args: Parameters<typeof series.updateSeries>
) {
  return actionResult(() => series.updateSeries(...args));
}

export async function removeSuggestionFeedback(
  ...args: Parameters<typeof suggestions.removeSuggestionFeedback>
) {
  return actionResult(() => suggestions.removeSuggestionFeedback(...args));
}

export async function restoreSuggestionFeedback(
  ...args: Parameters<typeof suggestions.restoreSuggestionFeedback>
) {
  return actionResult(() => suggestions.restoreSuggestionFeedback(...args));
}

export async function setSuggestionFeedback(
  ...args: Parameters<typeof suggestions.setSuggestionFeedback>
) {
  return actionResult(() => suggestions.setSuggestionFeedback(...args));
}

export async function updateWorkTaxonomy(
  ...args: Parameters<typeof taxonomy.updateWorkTaxonomy>
) {
  return actionResult(() => taxonomy.updateWorkTaxonomy(...args));
}

export async function linkVenueInstitution(
  ...args: Parameters<typeof venue_pages.linkVenueInstitution>
) {
  return actionResult(() => venue_pages.linkVenueInstitution(...args));
}

export async function removeVenue(
  ...args: Parameters<typeof venue_pages.removeVenue>
) {
  return actionResult(() => venue_pages.removeVenue(...args));
}

export async function setVenueArchived(
  ...args: Parameters<typeof venue_pages.setVenueArchived>
) {
  return actionResult(() => venue_pages.setVenueArchived(...args));
}

export async function unlinkVenueInstitution(
  ...args: Parameters<typeof venue_pages.unlinkVenueInstitution>
) {
  return actionResult(() => venue_pages.unlinkVenueInstitution(...args));
}

export async function createVenue(
  ...args: Parameters<typeof venues.createVenue>
) {
  return actionResult(() => venues.createVenue(...args));
}

export async function updateVenue(
  ...args: Parameters<typeof venues.updateVenue>
) {
  return actionResult(() => venues.updateVenue(...args));
}

export async function deleteWhereabouts(
  ...args: Parameters<typeof whereabouts.deleteWhereabouts>
) {
  return actionResult(() => whereabouts.deleteWhereabouts(...args));
}

export async function recordWhereabouts(
  ...args: Parameters<typeof whereabouts.recordWhereabouts>
) {
  return actionResult(() => whereabouts.recordWhereabouts(...args));
}

export async function updateWhereabouts(
  ...args: Parameters<typeof whereabouts.updateWhereabouts>
) {
  return actionResult(() => whereabouts.updateWhereabouts(...args));
}

export async function verifyWhereabouts(
  ...args: Parameters<typeof whereabouts.verifyWhereabouts>
) {
  return actionResult(() => whereabouts.verifyWhereabouts(...args));
}

export async function createWorkRelation(
  ...args: Parameters<typeof work_relations.createWorkRelation>
) {
  return actionResult(() => work_relations.createWorkRelation(...args));
}

export async function deleteWorkRelation(
  ...args: Parameters<typeof work_relations.deleteWorkRelation>
) {
  return actionResult(() => work_relations.deleteWorkRelation(...args));
}

export async function deleteWork(
  ...args: Parameters<typeof works.deleteWork>
) {
  return actionResult(() => works.deleteWork(...args));
}

export async function updateWork(
  ...args: Parameters<typeof works.updateWork>
) {
  return actionResult(() => works.updateWork(...args));
}

// Searches and decisions whose refusals are written for people (SLN-1033)

export async function findOrCreateAuthor(
  ...args: Parameters<typeof authors.findOrCreateAuthor>
) {
  return actionResult(() => authors.findOrCreateAuthor(...args));
}

export async function findEditionCandidates(
  ...args: Parameters<typeof identify.findEditionCandidates>
) {
  return actionResult(() => identify.findEditionCandidates(...args));
}

export async function previewMatch(
  ...args: Parameters<typeof match.previewMatch>
) {
  return actionResult(() => match.previewMatch(...args));
}

export async function applyMatch(
  ...args: Parameters<typeof match.applyMatch>
) {
  return actionResult(() => match.applyMatch(...args));
}

export async function resolvePublisherNames(
  ...args: Parameters<typeof publisher_names.resolvePublisherNames>
) {
  return actionResult(() => publisher_names.resolvePublisherNames(...args));
}

export async function applySafePublisherDecisions(
  ...args: Parameters<typeof publisher_names.applySafePublisherDecisions>
) {
  return actionResult(() => publisher_names.applySafePublisherDecisions(...args));
}

export async function restorePublisherName(
  ...args: Parameters<typeof publisher_names.restorePublisherName>
) {
  return actionResult(() => publisher_names.restorePublisherName(...args));
}

export async function undoAutomaticPublisherDecision(
  ...args: Parameters<typeof publisher_names.undoAutomaticPublisherDecision>
) {
  return actionResult(() => publisher_names.undoAutomaticPublisherDecision(...args));
}

export async function findPageCount(
  ...args: Parameters<typeof reading.findPageCount>
) {
  return actionResult(() => reading.findPageCount(...args));
}

export async function markWorksRead(
  ...args: Parameters<typeof reading_bulk.markWorksRead>
) {
  return actionResult(() => reading_bulk.markWorksRead(...args));
}

export async function undoMarkWorksRead(
  ...args: Parameters<typeof reading_bulk.undoMarkWorksRead>
) {
  return actionResult(() => reading_bulk.undoMarkWorksRead(...args));
}

// Films, paintings and perfumes: their own records and copies (SLN-1033)

export async function createFilm(
  ...args: Parameters<typeof films.createFilm>
) {
  return actionResult(() => films.createFilm(...args));
}

export async function updateFilm(
  ...args: Parameters<typeof films.updateFilm>
) {
  return actionResult(() => films.updateFilm(...args));
}

export async function deleteFilm(
  ...args: Parameters<typeof films.deleteFilm>
) {
  return actionResult(() => films.deleteFilm(...args));
}

export async function addFilmHolding(
  ...args: Parameters<typeof films.addFilmHolding>
) {
  return actionResult(() => films.addFilmHolding(...args));
}

export async function updateFilmHolding(
  ...args: Parameters<typeof films.updateFilmHolding>
) {
  return actionResult(() => films.updateFilmHolding(...args));
}

export async function deleteFilmHolding(
  ...args: Parameters<typeof films.deleteFilmHolding>
) {
  return actionResult(() => films.deleteFilmHolding(...args));
}

export async function createPainting(
  ...args: Parameters<typeof paintings.createPainting>
) {
  return actionResult(() => paintings.createPainting(...args));
}

export async function updatePainting(
  ...args: Parameters<typeof paintings.updatePainting>
) {
  return actionResult(() => paintings.updatePainting(...args));
}

export async function deletePainting(
  ...args: Parameters<typeof paintings.deletePainting>
) {
  return actionResult(() => paintings.deletePainting(...args));
}

export async function createPerfume(
  ...args: Parameters<typeof perfumes.createPerfume>
) {
  return actionResult(() => perfumes.createPerfume(...args));
}

export async function updatePerfume(
  ...args: Parameters<typeof perfumes.updatePerfume>
) {
  return actionResult(() => perfumes.updatePerfume(...args));
}

export async function deletePerfume(
  ...args: Parameters<typeof perfumes.deletePerfume>
) {
  return actionResult(() => perfumes.deletePerfume(...args));
}

export async function addPerfumeBottle(
  ...args: Parameters<typeof perfumes.addPerfumeBottle>
) {
  return actionResult(() => perfumes.addPerfumeBottle(...args));
}

export async function updatePerfumeBottle(
  ...args: Parameters<typeof perfumes.updatePerfumeBottle>
) {
  return actionResult(() => perfumes.updatePerfumeBottle(...args));
}

export async function deletePerfumeBottle(
  ...args: Parameters<typeof perfumes.deletePerfumeBottle>
) {
  return actionResult(() => perfumes.deletePerfumeBottle(...args));
}

/**
 * A delete made from the record's own page (SLN-1330). On success the action
 * redirects to the list, so its one response renders the list: answering the
 * page instead re-rendered the deleted record as "Page not found" before the
 * tab left. A refusal stays on the page as data, as does an outcome the page
 * must still report (`stay`, such as image files left to clean up).
 */
async function deleteThenLeave<T>(to: string, run: () => Promise<T>, stay?: (value: T) => boolean) {
  const result = await actionResult(run);
  if (result.ok && !stay?.(result.value)) redirect(to, RedirectType.replace);
  return result;
}

export async function deleteCollectionFromPage(id: string) {
  return deleteThenLeave("/collections", () => collections.deleteCollection(id), (outcome) => outcome.cleanupPending);
}

export async function deleteFilmFromPage(id: string) {
  return deleteThenLeave("/films", () => films.deleteFilm(id), (outcome) => outcome.cleanupPending);
}

export async function deleteWorkFromPage(id: string) {
  return deleteThenLeave("/library", () => works.deleteWork(id));
}

export async function removeOrganizationFromPage(id: string) {
  return deleteThenLeave("/organizations", () => organization_directory.removeOrganization(id));
}

export async function deletePaintingFromPage(id: string) {
  return deleteThenLeave("/paintings", () => paintings.deletePainting(id), (outcome) => outcome.cleanupPending);
}

export async function deleteAuthorFromPage(id: string) {
  return deleteThenLeave("/people", () => authors.deleteAuthor(id));
}

export async function deletePerfumeFromPage(id: string) {
  return deleteThenLeave("/perfumes", () => perfumes.deletePerfume(id), (outcome) => outcome.cleanupPending);
}

export async function removeVenueFromPage(id: string) {
  return deleteThenLeave("/places", () => venue_pages.removeVenue(id));
}

export async function deleteRecommenderFromPage(id: string) {
  return deleteThenLeave("/recommenders", () => recommenders.deleteRecommender(id));
}

export async function deleteSeriesFromPage(id: string) {
  return deleteThenLeave("/series", () => series.deleteSeries(id));
}

export async function decideImportRow(
  ...args: Parameters<typeof reading_import.decideImportRow>
) {
  return actionResult(() => reading_import.decideImportRow(...args));
}

export async function decideImportSection(
  ...args: Parameters<typeof reading_import.decideImportSection>
) {
  return actionResult(() => reading_import.decideImportSection(...args));
}

export async function rematchImport(
  ...args: Parameters<typeof reading_import.rematchImport>
) {
  return actionResult(() => reading_import.rematchImport(...args));
}

export async function commitReadingImport(
  ...args: Parameters<typeof reading_import.commitReadingImport>
) {
  return actionResult(() => reading_import.commitReadingImport(...args));
}

export async function undoReadingImport(
  ...args: Parameters<typeof reading_import.undoReadingImport>
) {
  return actionResult(() => reading_import.undoReadingImport(...args));
}

export async function decideImportNote(
  ...args: Parameters<typeof reading_import.decideImportNote>
) {
  return actionResult(() => reading_import.decideImportNote(...args));
}

export async function decideAllImportNotes(
  ...args: Parameters<typeof reading_import.decideAllImportNotes>
) {
  return actionResult(() => reading_import.decideAllImportNotes(...args));
}

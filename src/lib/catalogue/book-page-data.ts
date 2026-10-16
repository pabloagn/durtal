import { getOrdersForWork } from "@/lib/actions/orders";
import { getEbookSuggestionCount } from "@/lib/ebooks/review-queue/suggestions";
import { getBookRelatedGroups } from "@/lib/actions/book-related";
import { getAcquisitionTargets } from "@/lib/actions/publishers";
import { getCollectionsForWork, getCollectionCoverPreviews } from "@/lib/actions/collections";
import { getSimilarWorks } from "@/lib/actions/similar-works";
import { getWorksWithMark, type getWorkBySlug } from "@/lib/actions/works";
import { getOtherWorksInSeries } from "@/lib/actions/series";
import { getWorkRelations } from "@/lib/actions/work-relations";
import { getReadingsForWork } from "@/lib/actions/reading";
import { getNotesForWork } from "@/lib/actions/reading-notes";
import { getQueuePlace } from "@/lib/actions/reading-queue";
import { readingDayStartHour } from "@/lib/reading/day";
import { readingDay } from "@/lib/reading/dates";
import { appTimeZone } from "@/lib/utils/date";
import { predictionGateOn, getBookPredictionContext } from "@/lib/reading/suggest/context";
import { readingEstimates } from "@/lib/reading/estimates";
import { catalogueAvailability } from "@/lib/ebooks/catalogue-availability";
import { getEbookReach } from "@/lib/ebooks/highlights";
import { marksOf } from "@/lib/constants/marks";
import { collectionPoster } from "@/components/collections/collection-card";
import { canUseWorkCapability } from "./domains";
import { linkedBookIds } from "./linked-work-ebooks";

type Book = Pick<NonNullable<Awaited<ReturnType<typeof getWorkBySlug>>>,
  "id" | "kind" | "seriesId" | "isRare" | "isPoison" | "isFavourite">;

/** Each dependent read starts when its inputs arrive, without waiting for unrelated sections. */
export async function loadBookPageData(work: Book) {
  const canRead = canUseWorkCapability(work.kind, "reading");
  const zone = appTimeZone();
  const ordersRead = getOrdersForWork(work.id);
  const suggestionsRead = getEbookSuggestionCount(work.id);
  const relatedRead = getBookRelatedGroups(work.id, 12);
  const targetsRead = getAcquisitionTargets(work.id);
  const collectionsRead = getCollectionsForWork(work.id);
  const similarRead = getSimilarWorks(work.id, 12);
  const marksRead = Promise.all(marksOf(work).map(async (mark) => ({
    mark, works: await getWorksWithMark(mark.key, work.id, 12),
  })));
  const seriesRead = work.seriesId ? getOtherWorksInSeries(work.seriesId, work.id) : Promise.resolve([]);
  const linksRead = getWorkRelations(work.id);
  const readingsRead = getReadingsForWork(work.id);
  const notesRead = canRead ? getNotesForWork(work.id) : Promise.resolve([]);
  const dayStartRead = readingDayStartHour();
  const queueRead = getQueuePlace(work.id);
  const gateRead = canRead ? predictionGateOn() : Promise.resolve(false);
  const todayRead = dayStartRead.then((hour) => readingDay(new Date(), zone, hour));

  const estimatesRead = Promise.all([readingsRead, todayRead]).then(([readings, today]) =>
    readingEstimates(readings.filter((r) => r.reading.status === "reading" || r.reading.status === "paused")
      .map((r) => r.reading.id), today));
  const predictionRead = Promise.all([gateRead, readingsRead]).then(([gateOn, readings]) =>
    canRead && gateOn && !readings.some((r) => r.reading.status === "finished")
      ? getBookPredictionContext(work.id) : null);
  const coversRead = collectionsRead.then((collections) =>
    getCollectionCoverPreviews(collections.filter((c) => !collectionPoster(c.media)).map((c) => c.id)));
  const digitalRead = Promise.all([seriesRead, relatedRead, marksRead, similarRead, linksRead])
    .then(([series, related, marks, similar, links]) => catalogueAvailability([
      work.id,
      ...series.map((related) => related.id),
      ...related.flatMap((group) => group.works.map((related) => related.id)),
      ...marks.flatMap((row) => row.works.map((related) => related.id)),
      ...similar.filter((related) => related.kind === "book").map((related) => related.id),
      ...linkedBookIds(links),
    ]));
  const reachRead = digitalRead.then((digital) =>
    getEbookReach((digital.get(work.id)?.ebooks ?? []).map((e) => e.ebookId)));

  const [workOrders, ebookSuggestionCount, relatedGroups, acquisitionTargets, workCollections,
    similarWorks, markRows, seriesWorks, links, readingRows, readingNotes, dayStartHour,
    queued, today, estimates, predictionContext, collectionCovers, digital, reach] = await Promise.all([
    ordersRead, suggestionsRead, relatedRead, targetsRead, collectionsRead, similarRead,
    marksRead, seriesRead, linksRead, readingsRead, notesRead, dayStartRead, queueRead,
    todayRead, estimatesRead, predictionRead, coversRead, digitalRead, reachRead,
  ]);
  return { workOrders, ebookSuggestionCount, relatedGroups, acquisitionTargets, workCollections,
    similarWorks, markRows, seriesWorks, links, readingRows, readingNotes, dayStartHour,
    queued, zone, today, estimates, predictionContext, collectionCovers, digital, reach };
}

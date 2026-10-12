/** Pure guards for the reviewed 300-turn benchmark precondition. */
export function assertTurnStart(place) {
  if (place?.ready !== true || place.index !== 0 || place.atStart !== true
    || place.atEnd !== false || place.percent !== "0" || place.sectionCount !== 100
    || typeof place.cfi !== "string" || place.cfi.length === 0)
    throw new Error("TURN_START_PRECONDITION_FAILED: expected first page of the 100-section fixture at 0%");
  return place;
}

export function partitionTurnEvents(events, measurementStartedAt) {
  if (!Number.isFinite(measurementStartedAt)) throw new Error("INVALID_TURN_MEASUREMENT_BOUNDARY");
  const setup = [], measured = [];
  for (const event of events) {
    if (!Number.isFinite(event.start)) throw new Error("INVALID_TURN_EVENT_START");
    (event.start < measurementStartedAt ? setup : measured).push(event);
  }
  return { setup, measured };
}

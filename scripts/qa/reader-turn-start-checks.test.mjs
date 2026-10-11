import test from "node:test";
import assert from "node:assert/strict";
import { assertTurnStart, partitionTurnEvents } from "./reader-turn-start-checks.mjs";

const start = { ready: true, index: 0, atStart: true, atEnd: false,
  percent: "0", sectionCount: 100, cfi: "epubcfi(/6/2!/4/2)" };

test("known fixture beginning is accepted", () => {
  assert.equal(assertTurnStart(start), start);
});
for (const [label, change] of [
  ["restored near EOF", { index: 89, atStart: false, percent: "89" }],
  ["actual EOF", { index: 99, atStart: false, atEnd: true, percent: "100" }],
  ["rounded zero away from first page", { atStart: false }],
  ["stale zero UI at later chapter", { index: 1 }],
  ["stale first chapter UI at end", { atEnd: true }],
  ["index still building", { ready: false }],
  ["wrong fixture length", { sectionCount: 1 }],
  ["zero label missing", { percent: null }],
  ["navigation not established", { cfi: null }],
]) test("rejects " + label + " before measurement", () => {
  assert.throws(() => assertTurnStart({ ...start, ...change }), /TURN_START_PRECONDITION_FAILED/);
});

test("late setup delivery remains setup by startTime; every post-boundary event remains measured", () => {
  const events = [
    { name: "keydown", start: 110, duration: 16 },
    { name: "keydown", start: 50, duration: 900 }, // delivered late, but began in setup
    { name: "pointerdown", start: 100, duration: 300 }, // inclusive boundary, retain slow event
    { name: "keydown", start: 130, duration: 2000 }, // retain later outlier
  ];
  const { setup, measured } = partitionTurnEvents(events, 100);
  assert.deepEqual(setup, [events[1]]);
  assert.deepEqual(measured, [events[0], events[2], events[3]]);
  assert.equal(setup.length + measured.length, events.length);
  assert.equal(measured[2].duration, 2000);
  assert.equal(events.length, 4); // raw observation array is not cleared or mutated
});
test("invalid timing cannot silently disappear from evidence", () => {
  assert.throws(() => partitionTurnEvents([], NaN), /INVALID_TURN_MEASUREMENT_BOUNDARY/);
  assert.throws(() => partitionTurnEvents([{ name: "keydown", duration: 16 }], 100), /INVALID_TURN_EVENT_START/);
});

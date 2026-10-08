/**
 * Read-only parity and loader timing on a disposable preview. Never prints book metadata.
 * pnpm exec tsx scripts/qa/book-prediction-parity.ts --database-url <local durtal_preview URL>
 * Seed taste evidence only on the disposable preview before running; no live URL is accepted.
 */
import assert from "node:assert/strict";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildContext } from "@/lib/reading/suggest/build";
import { loadBooks, toBooks } from "@/lib/reading/suggest/load";
import {
  buildPredictionContext,
  loadPrediction,
} from "@/lib/reading/suggest/prediction-load";
import {
  evaluatePredictions,
  predict,
  predictionSource,
  predictionText,
  type Prediction,
} from "@/lib/reading/suggest/predict";

const argument = process.argv.indexOf("--database-url");
const url = argument >= 0 ? process.argv[argument + 1] : "";
const parsed = URL.parse(url);
if (
  !parsed ||
  !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
  parsed.pathname !== "/durtal_preview"
) {
  throw new Error(
    "Only an explicit disposable local durtal_preview database is accepted",
  );
}
const client = postgres(url, {
  max: 1,
  onnotice: () => {},
  connection: { default_transaction_read_only: "on", jit: "off" },
});
const db = drizzle(client);
const execute = (query: Parameters<typeof db.execute>[0]) => db.execute(query);
const summary = (p: Prediction | null) =>
  p && {
    value: p.value,
    low: p.low,
    high: p.high,
    text: predictionText(p),
    source: predictionSource(p),
    neighbours: p.neighbours.map((n) => ({
      id: n.book.id,
      similarity: n.similarity,
      rating: n.rating,
    })),
  };
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
try {
  const full = buildContext({
    today: "",
    homeId: null,
    homes: [],
    books: toBooks(await loadBooks(execute, null), []),
    queueLength: 0,
    priors: { byLanguageFormat: {}, byFormat: {}, overall: null },
    hideAnathema: false,
    gate: null,
  });
  const unread = full.books.filter((b) => !b.finishedCount);
  assert.ok(
    full.rated.length >= 30,
    "Seed at least 30 taste-evidence books in the disposable preview",
  );
  assert.ok(unread.length > 0, "Expected unread targets");
  let predictions = 0;
  for (const [i, target] of unread.entries()) {
    const ctx = buildPredictionContext(
      await loadPrediction(execute, target.id),
    );
    assert.equal(
      ctx.books.length,
      full.rated.length + 1,
      `Selected-book count differs at target ${i}`,
    );
    assert.deepEqual(
      [...ctx.idf].sort(),
      [...full.idf].sort(),
      `IDF differs at target ${i}`,
    );
    assert.deepEqual(
      ctx.rated.map((b) => [b.id, b.taste]),
      full.rated.map((b) => [b.id, b.taste]),
      `Taste order differs at target ${i}`,
    );
    assert.equal(ctx.meanTaste, full.meanTaste, `Mean differs at target ${i}`);
    assert.deepEqual(
      evaluatePredictions(ctx),
      evaluatePredictions(full),
      `Gate evaluation differs at target ${i}`,
    );
    const p = predict(ctx.byId.get(target.id)!, ctx);
    assert.deepEqual(
      summary(p),
      summary(predict(target, full)),
      `Prediction differs at target ${i}`,
    );
    if (p) predictions++;
  }
  assert.ok(predictions > 0, "Expected non-null predictions");
  const before: number[] = [],
    after: number[] = [];
  for (let i = 0; i < 33; i++) {
    const target = unread[i % unread.length];
    const oldLoad = async () => {
      const start = performance.now();
      await loadBooks(execute, null);
      return performance.now() - start;
    };
    const newLoad = async () => {
      const start = performance.now();
      await loadPrediction(execute, target.id);
      return performance.now() - start;
    };
    // Alternate order to limit warm-cache and drift bias; the first three pairs are warmups.
    const pair =
      i % 2
        ? [await newLoad(), await oldLoad()].reverse()
        : [await oldLoad(), await newLoad()];
    if (i >= 3) {
      before.push(pair[0]);
      after.push(pair[1]);
    }
  }
  console.log(
    JSON.stringify(
      {
        bookCount: full.books.length,
        tasteBooks: full.rated.length,
        unreadCompared: unread.length,
        predicted: predictions,
        nullPredictions: unread.length - predictions,
        mismatches: 0,
        gateEvaluation: evaluatePredictions(full),
        loaderTiming: {
          warmupPairs: 3,
          samplePairs: before.length,
          fullMedianMs: median(before),
          targetedMedianMs: median(after),
          fullSamplesMs: before,
          targetedSamplesMs: after,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}

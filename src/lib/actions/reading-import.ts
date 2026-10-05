"use server";

import { z } from "zod/v4";
import { chooseBook, commitImport, decideRow, decideSection, rematch, undoImport } from "@/lib/reading/import/store";
import {
  decideImportRowSchema,
  decideImportSectionSchema,
  importIdSchema,
  type DecideImportRowInput,
} from "@/lib/validations/reading-import";

/*
 * The reading import's actions (SLN-450). The upload is a route
 * (`POST /api/reading/import`): a full Goodreads export passes the server
 * action body limit. Each decision is one UPDATE of one row. No activity
 * event: no event type fits an import, and the imports list records it.
 */

/** Import, skip, choose another book, or use the file's rating, for one row */
export async function decideImportRow(input: DecideImportRowInput) {
  const data = decideImportRowSchema.parse(input);
  if (data.workId) await chooseBook({ importId: data.importId, rowNo: data.rowNo, workId: data.workId });
  if (data.decision !== undefined || data.useFileRating !== undefined)
    await decideRow({ importId: data.importId, rowNo: data.rowNo, decision: data.decision, useFileRating: data.useFileRating });
}

/** "Accept all likely matches" and "Skip all not in Durtal" */
export async function decideImportSection(input: z.input<typeof decideImportSectionSchema>) {
  return decideSection(decideImportSectionSchema.parse(input));
}

/** "Match again": the rows still without a book */
export async function rematchImport(input: z.input<typeof importIdSchema>) {
  return rematch(importIdSchema.parse(input).importId);
}

/** Writes the readings of the rows decided "import" */
export async function commitReadingImport(input: z.input<typeof importIdSchema>) {
  return commitImport(importIdSchema.parse(input).importId);
}

/** Removes what the import wrote, keeping readings edited since */
export async function undoReadingImport(input: z.input<typeof importIdSchema>) {
  return undoImport(importIdSchema.parse(input).importId);
}

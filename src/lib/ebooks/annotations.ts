import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ebookAnnotations } from "@/lib/db/schema";
import { resultRows } from "@/lib/harmonization/store";
import { annotationUpsertSchema } from "@/lib/validations/annotations";
import { canonicalAnnotationTime } from "@/lib/reader/sync/annotation-time";
import type { AnnotationColor } from "@/lib/reader/annotations";
import type { DurtalLocator } from "@/lib/reader/engine";

export interface HighlightInput {
  ebookId: string;
  fileId: string;
  locator: DurtalLocator;
  text: string;
  chapter?: string | null;
  color?: AnnotationColor;
  style?: "highlight" | "quote";
}
export interface HighlightPlan {
  readonly id: string;
  readonly ebookId: string;
  readonly fileId: string;
  readonly locator: DurtalLocator;
  readonly text: string;
  readonly chapter: string | null;
  readonly color: AnnotationColor | null;
  readonly style: "highlight" | "quote";
  readonly clientUpdatedAt: string;
}
const plans = new WeakSet<HighlightPlan>();
const immutableLocator = (locator: DurtalLocator): DurtalLocator => {
  const copy = structuredClone(locator);
  if (copy.text) Object.freeze(copy.text);
  if (copy.pdf) {
    copy.pdf.rects?.forEach((rect) => Object.freeze(rect));
    if (copy.pdf.rects) Object.freeze(copy.pdf.rects);
    Object.freeze(copy.pdf);
  }
  return Object.freeze(copy);
};
type Db = typeof db;

/** Preparation only: parses the whole passage and checks real book/file facts.
 * It never creates a row or starts a transaction. Actual relationships are
 * checked again by the reviewed lifecycle trigger under book/identity locks.
 */
export async function planHighlight(
  input: HighlightInput,
  on: Db = db,
): Promise<HighlightPlan> {
  const ebookId = z.uuid().parse(input.ebookId).toLowerCase();
  const style = z
    .enum(["highlight", "quote"])
    .parse(input.style ?? "highlight");
  const id = randomUUID();
  const at = canonicalAnnotationTime(new Date().toISOString());
  const parsed = annotationUpsertSchema().parse({
    op: "put",
    id,
    fileId: input.fileId,
    kind: "highlight",
    style: "highlight",
    color: input.color ?? "ochre",
    locator: input.locator,
    text: input.text.trim(),
    note: null,
    chapter: input.chapter ?? null,
    clientUpdatedAt: at,
  });
  if (parsed.op !== "put") throw new Error("Invalid highlight plan");
  const [facts] = resultRows<{
    ebook: boolean;
    file: boolean;
    hash: string | null;
  }>(
    await on.execute(sql`
    select exists(select 1 from ebooks where id = ${ebookId}::uuid) as ebook,
      exists(select 1 from ebook_files where id = ${parsed.fileId}::uuid and ebook_id = ${ebookId}::uuid) as file,
      (select sha256 from ebook_files where id = ${parsed.fileId}::uuid and ebook_id = ${ebookId}::uuid) as hash`),
  );
  if (!facts?.ebook) throw new Error("This eBook no longer exists");
  if (!facts.file || facts.hash !== parsed.locator.fileHash)
    throw new Error("The passage is not from this eBook file");
  const plan: HighlightPlan = Object.freeze({
    id,
    ebookId,
    fileId: parsed.fileId,
    locator: immutableLocator(parsed.locator),
    text: parsed.text!,
    chapter: parsed.chapter,
    color: style === "quote" ? null : parsed.color,
    style,
    clientUpdatedAt: at,
  });
  plans.add(plan);
  return plan;
}

/** Internal tracker entry point. Build this insert inside the caller's atomic
 * batch with the note insert: a failure anywhere rolls back both. This is the
 * sole source entry point that can create quote style; browser puts cannot.
 */
export function createHighlight(d: Db, plan: HighlightPlan) {
  if (!plans.has(plan))
    throw new Error("A highlight requires its prepared server plan");
  return {
    id: plan.id,
    queries: [
      d.insert(ebookAnnotations).values({
        id: plan.id,
        ebookId: plan.ebookId,
        fileId: plan.fileId,
        kind: "highlight",
        style: plan.style,
        color: plan.color,
        locator: plan.locator,
        progression: plan.locator.totalProgression,
        chapter: plan.chapter,
        text: plan.text,
        note: null,
        anchorState: "exact",
        clientUpdatedAt: plan.clientUpdatedAt,
      }),
    ],
  };
}

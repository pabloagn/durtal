import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_ENRICHMENT_MODEL_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln462_enrichment_model")
    throw new Error("Enrichment model tests require disposable local sln462_enrichment_model");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), CACHE_TAGS: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { deleteWork } from "@/lib/actions/works";
import { deleteEdition } from "@/lib/actions/editions";

/*
 * SLN-462: the book enrichment model (migration 0077). Every guard is tried by
 * direct SQL; the merge and delete rules through Harmonize and the actions.
 */

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
/** A stored page's text and its hash, as SLN-468 records them */
const PAGE = "A long, dark novel of a city in the desert.";
const PAGE_SHA = sha(PAGE);
const OUTSIDE = [
  { title: "Nadja", author: "André Breton" },
  { title: "Là-bas", author: "J.-K. Huysmans" },
  { title: "Malina", author: "Ingeborg Bachmann" },
];

describe.skipIf(!url)("the book enrichment model", () => {
  const c = client!;
  const run = randomUUID();
  const ids = {} as Record<
    | "themesFamily"
    | "attributesFamily"
    | "moods"
    | "dark"
    | "bleak"
    | "slow"
    | "fast"
    | "gory"
    | "melancholy"
    | "tone"
    | "pace"
    | "mood"
    | "setting"
    | "composition"
    | "originalYear"
    | "wikidata"
    | "pages"
    | "translator"
    | "darkTerm"
    | "bleakTerm"
    | "slowTerm"
    | "fastTerm"
    | "melancholyTerm",
    string
  >;

  const book = async (title: string) => {
    const [w] = await c`insert into works(title, slug) values (${title}, ${`${title.toLowerCase().replace(/\W+/g, "-")}-${randomUUID().slice(0, 8)}`}) returning id`;
    return w.id as string;
  };
  const edition = async (workId: string) => {
    const [e] = await c`insert into editions(work_id, title) values (${workId}, 'Edition') returning id`;
    return e.id as string;
  };
  /** An API answer (or a stored page) owned by a book or an edition */
  const source = async (
    owner: { work: string } | { edition: string },
    provider = "wikidata",
    payload: Record<string, unknown> = { labels: { en: "Dark" }, year: "1951", textSha256: PAGE_SHA },
  ) => {
    const json = JSON.stringify(payload);
    const [s] =
      "work" in owner
        ? await c`insert into source_records(entity_kind, work_id, provider, retrieved_at, payload, payload_hash, review_status) values ('book', ${owner.work}, ${provider}, now(), ${json}::jsonb, ${sha(json)}, 'accepted') returning id`
        : await c`insert into source_records(entity_kind, edition_id, provider, retrieved_at, payload, payload_hash, review_status) values ('edition', ${owner.edition}, ${provider}, now(), ${json}::jsonb, ${sha(json)}, 'accepted') returning id`;
    return s.id as string;
  };
  type Sql = postgres.Sql;
  /** postgres.js types a transaction without the tagged-template call */
  const asSql = (tx: postgres.TransactionSql) => tx as unknown as postgres.Sql;
  /** One excerpt of an API answer at its path */
  const payloadEvidence = (t: Sql, claimId: string, sourceId: string, excerpt = "Dark", path = ["labels", "en"], outlet = "wikidata") =>
    t`insert into claim_evidence(claim_id, source_record_id, outlet, extractor_version, run_id, locator, excerpt, excerpt_sha256, payload_path)
      values (${claimId}, ${sourceId}, ${outlet}, 'map-v1', ${run}, 'payload', ${excerpt}, ${sha(excerpt)}, ${`{${path.join(",")}}`}::text[]) returning id`;
  /** A claim and its evidence in one transaction, as proposeClaims writes them */
  const claim = async (
    fields: Record<string, unknown>,
    sources: string[] = [],
    path?: { excerpt: string; path: string[]; outlet?: string },
  ) =>
    c.begin(async (tx) => {
        const t = asSql(tx);
      const [row] = await t`insert into enrichment_claims ${t({
        method: "api",
        confidence: 0.8,
        vocabulary_version: 1,
        run_id: run,
        ...fields,
      })} returning *`;
      for (const s of sources) await payloadEvidence(t, row.id, s, path?.excerpt, path?.path, path?.outlet);
      return row as Record<string, string>;
    });
  const accept = (claimId: string) =>
    c`update enrichment_claims set status = 'accepted', decided_by = 'pablo', decided_at = now() where id = ${claimId}`;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`insert into enrichment_vocabulary_versions(version, approved_at, approval_url, seed_sha256) values
      (1, now(), 'https://linear.app/sanctum-black/issue/SLN-461#comment-1', ${"a".repeat(64)}),
      (2, now(), 'https://linear.app/sanctum-black/issue/SLN-461#comment-2', ${"b".repeat(64)})`;
    ids.themesFamily = (await c`select id from taxonomy_families where system_table = 'themes'`)[0].id;
    ids.attributesFamily = (await c`select id from taxonomy_families where system_table = 'attributes'`)[0].id;
    ids.moods = (await c`insert into taxonomy_families(name, slug, is_system, entity_level, hierarchical) values ('Moods', 'moods', false, 'work', true) returning id`)[0].id;
    ids.dark = (await c`insert into themes(name, slug, level) values ('Dark', 'dark', 1) returning id`)[0].id;
    ids.bleak = (await c`insert into themes(name, slug, level) values ('Bleak', 'bleak', 1) returning id`)[0].id;
    ids.slow = (await c`insert into attributes(name, slug, category) values ('Slow', 'slow', 'pace') returning id`)[0].id;
    ids.fast = (await c`insert into attributes(name, slug, category) values ('Fast', 'fast', 'pace') returning id`)[0].id;
    ids.gory = (await c`insert into attributes(name, slug, category) values ('Gory', 'gory', 'content') returning id`)[0].id;
    ids.melancholy = (await c`insert into custom_taxonomy_items(family_id, name, slug) values (${ids.moods}, 'Melancholy', 'melancholy') returning id`)[0].id;
    const dimension = async (fields: Record<string, unknown>) =>
      (await c`insert into enrichment_dimensions ${c({ label: String(fields.key), definition: "A definition.", introduced_in: 1, ...fields })} returning id`)[0].id as string;
    ids.tone = await dimension({ key: "tone", layer: "experience", value_kind: "terms", apply_target: "taxonomy", taxonomy_family_id: ids.themesFamily });
    ids.pace = await dimension({ key: "pace", layer: "experience", value_kind: "scale", apply_target: "taxonomy", taxonomy_family_id: ids.attributesFamily, attribute_category: "pace" });
    ids.mood = await dimension({ key: "mood", layer: "experience", value_kind: "term", apply_target: "taxonomy", taxonomy_family_id: ids.moods });
    ids.setting = await dimension({ key: "setting", layer: "facts", value_kind: "place", apply_target: "values" });
    ids.composition = await dimension({ key: "composition_year", layer: "facts", value_kind: "number", apply_target: "values" });
    ids.originalYear = await dimension({ key: "original_year", layer: "facts", value_kind: "number", apply_target: "work.original_year" });
    ids.wikidata = await dimension({ key: "wikidata", layer: "identity", value_kind: "identifier", apply_target: "identifier", provider: "wikidata", auto_accept_eligible: true });
    ids.pages = await dimension({ key: "pages", layer: "length", value_kind: "number", apply_target: "none" });
    ids.translator = await dimension({ key: "translator", layer: "facts", value_kind: "person", apply_target: "edition.translator", entity_level: "edition" });
    const term = async (fields: Record<string, unknown>) =>
      (await c`insert into enrichment_terms ${c({ label: String(fields.key), definition: "A definition.", applies_when: "When it does.", does_not_apply_when: "When it does not.", introduced_in: 1, ...fields, examples: JSON.stringify(fields.examples ?? OUTSIDE) })} returning id`)[0].id as string;
    ids.darkTerm = await term({ dimension_id: ids.tone, key: "dark", system_item_id: ids.dark });
    ids.bleakTerm = await term({ dimension_id: ids.tone, key: "bleak", system_item_id: ids.bleak, retired_in: 2 });
    ids.slowTerm = await term({ dimension_id: ids.pace, key: "slow", system_item_id: ids.slow, scale_value: 1, examples: OUTSIDE.slice(0, 1) });
    ids.fastTerm = await term({ dimension_id: ids.pace, key: "fast", system_item_id: ids.fast, scale_value: 3, examples: OUTSIDE.slice(0, 1) });
    ids.melancholyTerm = await term({ dimension_id: ids.mood, key: "melancholy", custom_item_id: ids.melancholy });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });

  describe("guards", () => {
    it("refuses a value of the wrong kind, a term of another dimension, a retired term, a wrong scale value and a measurement", async () => {
      const a = await book("Guards");
      const evidence = await source({ work: a });
      const refused = async (fields: Record<string, unknown>, constraint: string) =>
        expect(claim({ work_id: a, ...fields }, [evidence])).rejects.toMatchObject({ code: "23514", constraint_name: constraint });
      await refused({ dimension_id: ids.tone, text_value: "dark" }, "enrichment_claim_value");
      await refused({ dimension_id: ids.tone, term_id: ids.darkTerm, number_value: 1 }, "enrichment_claim_value");
      await refused({ dimension_id: ids.mood, term_id: ids.darkTerm }, "enrichment_claim_value");
      await refused({ dimension_id: ids.tone, term_id: ids.bleakTerm, vocabulary_version: 2 }, "enrichment_claim_value");
      await refused({ dimension_id: ids.pace, term_id: ids.slowTerm, number_value: 2 }, "enrichment_claim_value");
      await refused({ dimension_id: ids.pages, number_value: 320 }, "enrichment_claim_dimension");
      await refused({ dimension_id: ids.translator, person_id: (await c`insert into authors(name, slug) values ('T', ${randomUUID()}) returning id`)[0].id }, "enrichment_claim_edition");
      // The retired term is still current in version 1, and the anchor's value fits
      await claim({ work_id: a, dimension_id: ids.tone, term_id: ids.bleakTerm }, [evidence]);
      await claim({ work_id: a, dimension_id: ids.pace, term_id: ids.slowTerm, number_value: 1 }, [evidence]);
      // A claim on a film is refused before anything else
      const [film] = await c`insert into works(title, kind, original_language) values ('Film', 'film', null) returning id`;
      await expect(claim({ work_id: film.id, dimension_id: ids.tone, term_id: ids.darkTerm }, [])).rejects.toMatchObject({
        constraint_name: "book_parent_required",
      });
    });

    it("keeps a claim's value, method and run, changes confidence only while proposed, and keeps a rejection final", async () => {
      const a = await book("Immutable");
      const row = await claim({ work_id: a, dimension_id: ids.tone, term_id: ids.darkTerm }, [await source({ work: a })]);
      await expect(c`update enrichment_claims set term_id = ${ids.bleakTerm} where id = ${row.id}`).rejects.toMatchObject({ constraint_name: "enrichment_claim_identity" });
      await expect(c`update enrichment_claims set method = 'agent' where id = ${row.id}`).rejects.toMatchObject({ constraint_name: "enrichment_claim_identity" });
      await expect(c`update enrichment_claims set work_id = ${await book("Elsewhere")} where id = ${row.id}`).rejects.toMatchObject({ constraint_name: "enrichment_claim_identity" });
      await c`update enrichment_claims set confidence = 0.9 where id = ${row.id}`;
      await c`update enrichment_claims set status = 'rejected', decided_by = 'pablo', decided_at = now(), decision_reason = 'wrong_value' where id = ${row.id}`;
      await expect(c`update enrichment_claims set confidence = 0.5 where id = ${row.id}`).rejects.toMatchObject({ constraint_name: "enrichment_claim_decision" });
      await expect(
        c`update enrichment_claims set status = 'proposed', decided_by = null, decided_at = null, decision_reason = null where id = ${row.id}`,
      ).rejects.toMatchObject({ constraint_name: "enrichment_claim_decision" });
      // A rejection needs its reason, and a rule decision its rule
      const other = await claim({ work_id: a, dimension_id: ids.tone, term_id: ids.darkTerm }, [await source({ work: a })]);
      await expect(c`update enrichment_claims set status = 'rejected', decided_by = 'pablo', decided_at = now() where id = ${other.id}`).rejects.toMatchObject({ constraint_name: "enrichment_claim_decision_check" });
      await expect(c`update enrichment_claims set status = 'accepted', decided_by = 'rule', decided_at = now() where id = ${other.id}`).rejects.toMatchObject({ constraint_name: "enrichment_claim_decision_check" });
    });

    it("needs evidence for an API or agent claim at commit, also after its evidence is deleted", async () => {
      const a = await book("Evidence required");
      await expect(claim({ work_id: a, dimension_id: ids.tone, term_id: ids.darkTerm, method: "agent" })).rejects.toMatchObject({
        constraint_name: "enrichment_claim_evidence",
      });
      const row = await claim({ work_id: a, dimension_id: ids.tone, term_id: ids.darkTerm }, [await source({ work: a })]);
      await expect(c`delete from claim_evidence where claim_id = ${row.id}`).rejects.toMatchObject({ constraint_name: "enrichment_claim_evidence" });
      // Withdrawn in the same transaction, it may lose its evidence
      await c.begin(async (tx) => {
        const t = asSql(tx);
        await t`delete from claim_evidence where claim_id = ${row.id}`;
        await t`update enrichment_claims set status = 'rejected', decided_by = 'check', decided_at = now(), decision_reason = 'evidence_deleted' where id = ${row.id}`;
      });
    });

    it("takes a human claim without evidence only as Pablo's accepted edit, and a proposed one only from his export", async () => {
      const a = await book("Human");
      const human = { work_id: a, dimension_id: ids.tone, term_id: ids.darkTerm, method: "human", confidence: 1, run_id: null };
      await expect(claim(human)).rejects.toMatchObject({ constraint_name: "enrichment_claim_evidence" });
      await claim({ ...human, status: "accepted", decided_by: "pablo", decided_at: new Date().toISOString() });
      await expect(claim({ ...human, term_id: ids.bleakTerm }, [await source({ work: a })])).rejects.toMatchObject({
        constraint_name: "enrichment_claim_evidence",
      });
      const exported = await source({ work: a }, "storygraph_export", { moods: ["dark"] });
      const proposed = await claim({ ...human, term_id: ids.bleakTerm }, [exported], {
        excerpt: "dark",
        path: ["moods", "0"],
        outlet: "storygraph_export",
      });
      expect(proposed.status).toBe("proposed");
    });

    it("keeps evidence unchanged, checks it against its source, and cites only the claim's book", async () => {
      const a = await book("Excerpts");
      const s = await source({ work: a });
      const row = await claim({ work_id: a, dimension_id: ids.tone, term_id: ids.darkTerm }, [s]);
      const [ev] = await c`select id from claim_evidence where claim_id = ${row.id}`;
      await expect(c`update claim_evidence set extractor_version = 'map-v2' where id = ${ev.id}`).rejects.toMatchObject({ constraint_name: "claim_evidence_identity" });
      const insert = (fields: { source?: string; excerpt?: string; path?: string[]; outlet?: string }) =>
        c.begin((tx) => payloadEvidence(asSql(tx), row.id, fields.source ?? s, fields.excerpt ?? "Dark", fields.path ?? ["labels", "en"], fields.outlet ?? "wikidata"));
      await expect(insert({ excerpt: "Darker" })).rejects.toMatchObject({ constraint_name: "claim_evidence_excerpt" });
      await expect(insert({ path: ["labels", "fr"], excerpt: "Dark " })).rejects.toMatchObject({ constraint_name: "claim_evidence_excerpt" });
      await expect(insert({ outlet: "open_library", excerpt: "1951", path: ["year"] })).rejects.toMatchObject({ constraint_name: "claim_evidence_source" });
      await expect(insert({ source: await source({ work: await book("Someone else") }), excerpt: "1951", path: ["year"] })).rejects.toMatchObject({
        constraint_name: "claim_evidence_source",
      });
      // A source of one of its editions counts as the book's
      await insert({ source: await source({ edition: await edition(a) }), excerpt: "1951", path: ["year"] });
      // A text excerpt names the stored text's hash, and its offsets span it
      const text = (sha256: string, start: number, excerpt: string) =>
        c`insert into claim_evidence(claim_id, source_record_id, outlet, extractor_version, run_id, locator, excerpt, excerpt_sha256, start_offset, end_offset, text_sha256)
          values (${row.id}, ${s}, 'wikidata', 'agent-v1', ${run}, 'text', ${excerpt}, ${sha(excerpt)}, ${start}, ${start + [...excerpt].length}, ${sha256})`;
      await expect(text("c".repeat(64), 7, "dark")).rejects.toMatchObject({ constraint_name: "claim_evidence_excerpt" });
      await text(PAGE_SHA, 8, "dark");
      await expect(
        c`insert into claim_evidence(claim_id, source_record_id, outlet, extractor_version, run_id, locator, excerpt, excerpt_sha256, start_offset, end_offset, text_sha256)
          values (${row.id}, ${s}, 'wikidata', 'agent-v1', ${run}, 'text', 'novel', ${sha("novel")}, 0, 9, ${PAGE_SHA})`,
      ).rejects.toMatchObject({ constraint_name: "claim_evidence_locator_check" });
      await expect(
        c`insert into claim_evidence(claim_id, source_record_id, outlet, extractor_version, run_id, locator, excerpt, excerpt_sha256, payload_path)
          values (${row.id}, ${s}, 'wikidata', 'map-v1', ${run}, 'payload', 'Dark', ${"0".repeat(64)}, '{labels,en}')`,
      ).rejects.toMatchObject({ constraint_name: "claim_evidence_value_check" });
    });

    it("keeps one open claim per value, NULLS NOT DISTINCT, and one row per place", async () => {
      const a = await book("Open claims");
      const s = await source({ work: a });
      await claim({ work_id: a, dimension_id: ids.tone, term_id: ids.darkTerm }, [s]);
      await expect(claim({ work_id: a, dimension_id: ids.tone, term_id: ids.darkTerm }, [s])).rejects.toMatchObject({
        code: "23505",
        constraint_name: "enrichment_claim_open_unique",
      });
      // Two concurrent proposals of one value: one wins, the other meets the index
      const results = await Promise.allSettled([
        claim({ work_id: a, dimension_id: ids.tone, term_id: ids.bleakTerm }, [s]),
        claim({ work_id: a, dimension_id: ids.tone, term_id: ids.bleakTerm }, [s]),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
      expect((await c`select count(*)::int as n from enrichment_claims where work_id = ${a} and term_id = ${ids.bleakTerm}`)[0].n).toBe(1);
      const [place] = await c`insert into places(name, type) values ('Santa Teresa', 'city') returning id`;
      const setting = await claim({ work_id: a, dimension_id: ids.setting, place_id: place.id }, [s]);
      await c.begin(async (tx) => {
        const t = asSql(tx);
        await t`update enrichment_claims set status = 'accepted', decided_by = 'pablo', decided_at = now() where id = ${setting.id}`;
        await t`insert into work_enrichment_values(work_id, dimension_id, place_id, claim_id) values (${a}, ${ids.setting}, ${place.id}, ${setting.id})`;
      });
      await expect(
        c`insert into work_enrichment_values(work_id, dimension_id, place_id, claim_id) values (${a}, ${ids.setting}, ${place.id}, ${randomUUID()})`,
      ).rejects.toMatchObject({ code: "23505", constraint_name: "work_enrichment_value_place_unique" });
    });

    it("keeps a value row to its accepted claim and one number per book", async () => {
      const a = await book("Values");
      const s = await source({ work: a });
      const first = await claim({ work_id: a, dimension_id: ids.composition, number_value: 1951 }, [s], { excerpt: "1951", path: ["year"] });
      const second = await claim({ work_id: a, dimension_id: ids.composition, number_value: 1952 }, [s], { excerpt: "1951", path: ["year"] });
      await expect(
        c`insert into work_enrichment_values(work_id, dimension_id, number_value, claim_id) values (${a}, ${ids.composition}, 1951, ${first.id})`,
      ).rejects.toMatchObject({ constraint_name: "enrichment_value_claim" });
      await c.begin(async (tx) => {
        const t = asSql(tx);
        await t`update enrichment_claims set status = 'accepted', decided_by = 'pablo', decided_at = now() where id = ${first.id}`;
        await t`insert into work_enrichment_values(work_id, dimension_id, number_value, claim_id) values (${a}, ${ids.composition}, 1951, ${first.id})`;
      });
      await expect(
        c.begin(async (tx) => {
        const t = asSql(tx);
          await t`update enrichment_claims set status = 'accepted', decided_by = 'pablo', decided_at = now() where id = ${second.id}`;
          await t`insert into work_enrichment_values(work_id, dimension_id, number_value, claim_id) values (${a}, ${ids.composition}, 1952, ${second.id})`;
        }),
      ).rejects.toMatchObject({ constraint_name: "enrichment_value_claim" });
      // An undone value row goes with its acceptance
      await expect(
        c`update enrichment_claims set status = 'proposed', decided_by = null, decided_at = null where id = ${first.id}`,
      ).rejects.toMatchObject({ constraint_name: "enrichment_value_claim" });
    });

    it("checks a term's item, and refuses deleting a governed item or changing its category", async () => {
      const term = (fields: Record<string, unknown>) =>
        c`insert into enrichment_terms ${c({ key: `t-${randomUUID().slice(0, 8)}`, label: "T", definition: "D", applies_when: "A", does_not_apply_when: "B", introduced_in: 2, ...fields, examples: JSON.stringify(OUTSIDE) })}`;
      await expect(term({ dimension_id: ids.tone, system_item_id: ids.slow })).rejects.toMatchObject({ constraint_name: "enrichment_term_item" });
      await expect(term({ dimension_id: ids.tone, system_item_id: randomUUID() })).rejects.toMatchObject({ constraint_name: "enrichment_term_item" });
      await expect(term({ dimension_id: ids.pace, system_item_id: ids.gory, scale_value: 2 })).rejects.toMatchObject({ constraint_name: "enrichment_term_item" });
      await expect(term({ dimension_id: ids.mood, custom_item_id: ids.melancholy, system_item_id: ids.dark })).rejects.toMatchObject({
        constraint_name: "enrichment_term_item_check",
      });
      await expect(term({ dimension_id: ids.setting, system_item_id: ids.dark })).rejects.toMatchObject({ constraint_name: "enrichment_term_dimension" });
      await expect(
        c`insert into enrichment_terms ${c({ key: "few", label: "T", definition: "D", applies_when: "A", does_not_apply_when: "B", introduced_in: 2, dimension_id: ids.tone, system_item_id: ids.bleak, examples: JSON.stringify(OUTSIDE.slice(0, 2)) })}`,
      ).rejects.toMatchObject({ constraint_name: "enrichment_term_examples" });
      // One current term per item: the dark theme is governed already
      await expect(term({ dimension_id: ids.tone, system_item_id: ids.dark })).rejects.toMatchObject({ constraint_name: "enrichment_term_item_current_unique" });
      // One current dimension per family and category
      await expect(
        c`insert into enrichment_dimensions ${c({ key: "pace_again", label: "Pace", definition: "D", layer: "experience", value_kind: "scale", apply_target: "taxonomy", taxonomy_family_id: ids.attributesFamily, attribute_category: "pace", introduced_in: 2 })}`,
      ).rejects.toMatchObject({ constraint_name: "enrichment_dimension_family_current_unique" });
      await expect(c`update enrichment_terms set definition = 'Changed' where id = ${ids.darkTerm}`).rejects.toMatchObject({ constraint_name: "enrichment_term_identity" });
      await expect(c`update enrichment_dimensions set value_kind = 'term' where id = ${ids.tone}`).rejects.toMatchObject({ constraint_name: "enrichment_dimension_identity" });
      await expect(c`delete from themes where id = ${ids.dark}`).rejects.toMatchObject({ code: "23503", constraint_name: "enrichment_term_item" });
      await expect(c`delete from custom_taxonomy_items where id = ${ids.melancholy}`).rejects.toMatchObject({ code: "23503" });
      await expect(c`update attributes set category = 'speed' where id = ${ids.slow}`).rejects.toMatchObject({ constraint_name: "enrichment_term_item" });
      // An ungoverned item goes as before
      const [loose] = await c`insert into themes(name, slug, level) values ('Loose', 'loose', 1) returning id`;
      await c`delete from themes where id = ${loose.id}`;
    });

    it("turns a rule on only with Pablo's approval, a gated one only at 95% on its sample, on eligible dimensions only", async () => {
      await expect(c`insert into enrichment_auto_accept_rules(dimension_id, basis) values (${ids.tone}, 'evaluation_gate')`).rejects.toMatchObject({
        constraint_name: "enrichment_rule_dimension",
      });
      const [rule] = await c`insert into enrichment_auto_accept_rules(dimension_id, basis) values (${ids.wikidata}, 'evaluation_gate') returning id`;
      const enable = (fields: string) => c.unsafe(`update enrichment_auto_accept_rules set enabled = true, ${fields} where id = $1`, [rule.id]);
      await expect(enable("enabled_at = now()")).rejects.toMatchObject({ constraint_name: "enrichment_rule_gate_check" });
      const passed = "approval_url = 'https://linear.app/x', enabled_at = now(), gold_set_version = 1, gate_passed_at = now(), minimum_sample = 50";
      await expect(enable(`${passed}, measured_precision = 0.94, sample_size = 60`)).rejects.toMatchObject({ constraint_name: "enrichment_rule_gate_check" });
      await expect(enable(`${passed}, measured_precision = 0.97, sample_size = 40`)).rejects.toMatchObject({ constraint_name: "enrichment_rule_gate_check" });
      await enable(`${passed}, measured_precision = 0.96, sample_size = 60`);
      await c`update enrichment_auto_accept_rules set enabled = false where id = ${rule.id}`;
      await expect(c`update enrichment_auto_accept_rules set basis = 'exact_identifier_match', dimension_id = ${ids.composition} where id = ${rule.id}`).rejects.toMatchObject({
        constraint_name: "enrichment_rule_dimension",
      });
    });

    it("keeps one open job per book and kind, running exactly when locked, held only for a listed reason", async () => {
      const a = await book("Jobs");
      await c`insert into enrichment_jobs(work_id, kind) values (${a}, 'identity')`;
      await expect(c`insert into enrichment_jobs(work_id, kind, status, held_reason) values (${a}, 'identity', 'held', 'quota')`).rejects.toMatchObject({
        code: "23505",
        constraint_name: "enrichment_job_open_unique",
      });
      await expect(c`insert into enrichment_jobs(work_id, kind, status) values (${a}, 'facts', 'held')`).rejects.toMatchObject({ constraint_name: "enrichment_job_state_check" });
      await expect(c`insert into enrichment_jobs(work_id, kind, status, held_reason) values (${a}, 'facts', 'held', 'tired')`).rejects.toMatchObject({ constraint_name: "enrichment_job_state_check" });
      await expect(c`insert into enrichment_jobs(work_id, kind, status) values (${a}, 'facts', 'running')`).rejects.toMatchObject({ constraint_name: "enrichment_job_state_check" });
      await c`insert into enrichment_jobs(work_id, kind, status, locked_at, locked_by) values (${a}, 'facts', 'running', now(), 'worker-1')`;
      await c`insert into enrichment_jobs(work_id, kind, status, finished_at) values (${a}, 'identity', 'done', now())`;
    });

    it("takes a snapshot only for a month, with its source record", async () => {
      const a = await book("Snapshots");
      const s = await source({ work: a }, "open_library", { readers: 12 });
      await expect(c`insert into work_popularity_snapshots(work_id, metric, month, value) values (${a}, 'readers', '2026-10-01', 12)`).rejects.toMatchObject({ code: "23502" });
      await expect(c`insert into work_popularity_snapshots(work_id, metric, month, value, source_record_id) values (${a}, 'readers', '2026-10-06', 12, ${s})`).rejects.toMatchObject({
        constraint_name: "work_popularity_snapshot_value_check",
      });
      await c`insert into work_popularity_snapshots(work_id, metric, month, value, source_record_id) values (${a}, 'readers', '2026-10-01', 12, ${s})`;
    });

    it("refuses an original title on a non-book and a blank one", async () => {
      const a = await book("Titles");
      await c`update works set original_title = 'Los detectives salvajes' where id = ${a}`;
      await expect(c`update works set original_title = '  ' where id = ${a}`).rejects.toMatchObject({ constraint_name: "works_original_title_check" });
      await expect(c`update works set original_title = ' Padded' where id = ${a}`).rejects.toMatchObject({ constraint_name: "works_original_title_check" });
      await expect(c`insert into works(title, kind, original_language, original_title) values ('Film', 'film', null, 'Häxan')`).rejects.toMatchObject({
        constraint_name: "works_original_title_check",
      });
    });
  });

  describe("deletes", () => {
    it("refuses deleting a cited source record at commit; deleteWork removes every enrichment row", async () => {
      const a = await book("Deleted");
      const s = await source({ work: a });
      const row = await claim({ work_id: a, dimension_id: ids.tone, term_id: ids.darkTerm }, [s]);
      await expect(c`delete from source_records where id = ${s}`).rejects.toMatchObject({ code: "23503" });
      const snapshot = await source({ work: a }, "open_library", { readers: 3 });
      await c`insert into work_popularity_snapshots(work_id, metric, month, value, source_record_id) values (${a}, 'readers', '2026-09-01', 3, ${snapshot})`;
      await c`insert into enrichment_jobs(work_id, kind) values (${a}, 'identity')`;
      const year = await claim({ work_id: a, dimension_id: ids.composition, number_value: 1951 }, [s], { excerpt: "1951", path: ["year"] });
      await c.begin(async (tx) => {
        const t = asSql(tx);
        await t`update enrichment_claims set status = 'accepted', decided_by = 'pablo', decided_at = now() where id = ${year.id}`;
        await t`insert into work_enrichment_values(work_id, dimension_id, number_value, claim_id) values (${a}, ${ids.composition}, 1951, ${year.id})`;
        await t`insert into enrichment_applications(claim_id, work_id, dimension_id, target, before, after, applied_by) values (${year.id}, ${a}, ${ids.composition}, 'values', '{}', '{"value": 1951}', 'pablo')`;
      });
      await deleteWork(a);
      for (const table of ["enrichment_claims", "work_enrichment_values", "enrichment_applications", "work_popularity_snapshots", "enrichment_jobs"])
        expect((await c`select count(*)::int as n from ${c(table)} where work_id = ${a}`)[0].n, table).toBe(0);
      expect((await c`select count(*)::int as n from claim_evidence where claim_id = ${row.id}`)[0].n).toBe(0);
    });

    it("deleteEdition refuses while an accepted value rests on its sources, and withdraws the proposals left without evidence", async () => {
      const a = await book("Editions");
      const e = await edition(a);
      const fromEdition = await source({ edition: e });
      const accepted = await claim({ work_id: a, dimension_id: ids.tone, term_id: ids.darkTerm }, [fromEdition]);
      await accept(accepted.id);
      await expect(deleteEdition(e)).rejects.toThrow("An accepted enrichment value rests only on this edition's sources. Undo that value first.");
      // With a second source the accepted value keeps evidence; the proposal does not
      await payloadEvidence(c, accepted.id, await source({ work: a }));
      const proposal = await claim({ work_id: a, dimension_id: ids.tone, term_id: ids.bleakTerm }, [fromEdition]);
      const [person] = await c`insert into authors(name, slug) values ('Chris Andrews', ${randomUUID()}) returning id`;
      const own = await claim({ work_id: a, edition_id: e, dimension_id: ids.translator, person_id: person.id }, [fromEdition]);
      await deleteEdition(e);
      expect((await c`select status, decided_by, decision_reason from enrichment_claims where id = ${proposal.id}`)[0]).toEqual({
        status: "rejected",
        decided_by: "check",
        decision_reason: "evidence_deleted",
      });
      expect((await c`select status from enrichment_claims where id = ${accepted.id}`)[0].status).toBe("accepted");
      expect(await c`select id from enrichment_claims where id = ${own.id}`).toEqual([]);
      expect((await c`select count(*)::int as n from claim_evidence where claim_id = ${accepted.id}`)[0].n).toBe(1);
    });
  });

  describe("merges", () => {
    const merge = async (entity: string, sourceId: string, targetId: string) => {
      const preview = await previewMerge(entity, sourceId, targetId);
      if (preview.blockers.length) throw new Error(preview.blockers[0]);
      return executeMerge({
        entity,
        sourceId,
        targetId,
        fingerprint: preview.fingerprint,
        choices: Object.fromEntries(preview.fields.filter((f) => f.conflict).map((f) => [f.key, "target" as const])),
      });
    };

    it("merges two books with claims, evidence, values, snapshots and jobs", async () => {
      const kept = await book("Kept");
      const merged = await book("Merged");
      const [ks, ms] = [await source({ work: kept }), await source({ work: merged })];
      // The same open proposal on both: the merged one is superseded by the kept one
      const keptOpen = await claim({ work_id: kept, dimension_id: ids.tone, term_id: ids.darkTerm }, [ks]);
      const mergedOpen = await claim({ work_id: merged, dimension_id: ids.tone, term_id: ids.darkTerm }, [ms]);
      // The same accepted place on both: one value row stays
      const [place] = await c`insert into places(name, type) values ('Santa Teresa', 'city') returning id`;
      const keptPlace = await claim({ work_id: kept, dimension_id: ids.setting, place_id: place.id }, [ks]);
      const mergedPlace = await claim({ work_id: merged, dimension_id: ids.setting, place_id: place.id }, [ms]);
      for (const [w, row] of [[kept, keptPlace], [merged, mergedPlace]] as const)
        await c.begin(async (tx) => {
        const t = asSql(tx);
          await t`update enrichment_claims set status = 'accepted', decided_by = 'pablo', decided_at = now() where id = ${row.id}`;
          await t`insert into work_enrichment_values(work_id, dimension_id, place_id, claim_id) values (${w}, ${ids.setting}, ${place.id}, ${row.id})`;
          await t`insert into enrichment_applications(claim_id, work_id, dimension_id, target, before, after, applied_by) values (${row.id}, ${w}, ${ids.setting}, 'values', '{}', '{"place": 1}', 'pablo')`;
        });
      // An open proposal only the merged book has moves
      const onlyMerged = await claim({ work_id: merged, dimension_id: ids.tone, term_id: ids.bleakTerm }, [ms]);
      const kSnap = await source({ work: kept }, "open_library", { readers: 1 });
      const mSnap = await source({ work: merged }, "open_library", { readers: 2 });
      await c`insert into work_popularity_snapshots(work_id, metric, month, value, source_record_id) values
        (${kept}, 'readers', '2026-09-01', 1, ${kSnap}), (${merged}, 'readers', '2026-09-01', 2, ${mSnap}), (${merged}, 'readers', '2026-08-01', 2, ${mSnap})`;
      await c`insert into enrichment_jobs(work_id, kind, run_after, payload) values
        (${kept}, 'facts', now() + interval '1 day', '{"dimensions": ["tone"]}'), (${merged}, 'facts', now(), '{"dimensions": ["setting"]}'),
        (${merged}, 'identity', now(), '{}')`;

      await merge("works", merged, kept);

      expect((await c`select work_id, status, superseded_by_claim_id from enrichment_claims where id = ${mergedOpen.id}`)[0]).toEqual({
        work_id: kept,
        status: "superseded",
        superseded_by_claim_id: keptOpen.id,
      });
      expect((await c`select status, superseded_by_claim_id from enrichment_claims where id = ${mergedPlace.id}`)[0]).toEqual({
        status: "superseded",
        superseded_by_claim_id: keptPlace.id,
      });
      expect((await c`select work_id, status from enrichment_claims where id = ${onlyMerged.id}`)[0]).toEqual({ work_id: kept, status: "proposed" });
      expect(await c`select claim_id from work_enrichment_values where dimension_id = ${ids.setting} and place_id = ${place.id}`).toEqual([{ claim_id: keptPlace.id }]);
      expect((await c`select count(*)::int as n from enrichment_applications where work_id = ${kept}`)[0].n).toBe(2);
      expect(await c`select month::text, value::int from work_popularity_snapshots where work_id = ${kept} order by month`).toEqual([
        { month: "2026-08-01", value: 2 },
        { month: "2026-09-01", value: 1 },
      ]);
      const jobs = await c`select kind, payload, run_after < now() as due from enrichment_jobs where work_id = ${kept} order by kind`;
      expect(jobs).toEqual([
        { kind: "facts", payload: { dimensions: ["setting", "tone"] }, due: true },
        { kind: "identity", payload: {}, due: true },
      ]);
      // Evidence stays with its claim, and its source moved to the kept book
      expect((await c`select s.work_id from claim_evidence e join source_records s on s.id = e.source_record_id where e.claim_id = ${mergedOpen.id}`)[0].work_id).toBe(kept);
    });

    it("refuses two books with different accepted values for one single-value dimension, and a merged book's running job", async () => {
      const kept = await book("Kept mood");
      const merged = await book("Merged mood");
      const [ks, ms] = [await source({ work: kept }), await source({ work: merged })];
      await accept((await claim({ work_id: kept, dimension_id: ids.pace, term_id: ids.slowTerm, number_value: 1 }, [ks])).id);
      const fast = await claim({ work_id: merged, dimension_id: ids.pace, term_id: ids.fastTerm, number_value: 3 }, [ms]);
      await accept(fast.id);
      await expect(merge("works", merged, kept)).rejects.toThrow("The two books have different accepted values for pace. Undo one of them before merging.");
      await c`update enrichment_claims set status = 'superseded', superseded_by_claim_id = null where id = ${fast.id}`;
      await c`insert into enrichment_jobs(work_id, kind, status, locked_at, locked_by) values (${merged}, 'research', 'running', now(), 'worker-1')`;
      await expect(merge("works", merged, kept)).rejects.toThrow("An enrichment job is running for the book being merged away. Merge once it finishes.");
      await c`update enrichment_jobs set status = 'done', locked_at = null, locked_by = null, finished_at = now() where work_id = ${merged}`;
      await merge("works", merged, kept);
    });

    it("merges two people and two places that hold claims and values", async () => {
      const a = await book("People and places");
      const e = await edition(a);
      const s = await source({ edition: e });
      const [keptPerson, mergedPerson] = await c`insert into authors(name, slug) values ('Chris Andrews', ${randomUUID()}), ('C. Andrews', ${randomUUID()}) returning id`;
      await claim({ work_id: a, edition_id: e, dimension_id: ids.translator, person_id: keptPerson.id }, [s]);
      const repeated = await claim({ work_id: a, edition_id: e, dimension_id: ids.translator, person_id: mergedPerson.id }, [s]);
      await merge("authors", mergedPerson.id, keptPerson.id);
      expect((await c`select person_id, status from enrichment_claims where id = ${repeated.id}`)[0]).toEqual({ person_id: keptPerson.id, status: "superseded" });

      const [keptPlace, mergedPlace] = await c`insert into places(name, type) values ('Comala', 'town'), ('Comala, Colima', 'town') returning id`;
      const ws = await source({ work: a });
      const first = await claim({ work_id: a, dimension_id: ids.setting, place_id: mergedPlace.id }, [ws]);
      await c.begin(async (tx) => {
        const t = asSql(tx);
        await t`update enrichment_claims set status = 'accepted', decided_by = 'pablo', decided_at = now() where id = ${first.id}`;
        await t`insert into work_enrichment_values(work_id, dimension_id, place_id, claim_id) values (${a}, ${ids.setting}, ${mergedPlace.id}, ${first.id})`;
      });
      await merge("places", mergedPlace.id, keptPlace.id);
      expect(await c`select place_id from work_enrichment_values where claim_id = ${first.id}`).toEqual([{ place_id: keptPlace.id }]);
      expect((await c`select place_id, status from enrichment_claims where id = ${first.id}`)[0]).toEqual({ place_id: keptPlace.id, status: "accepted" });
    });

    it("refuses merging away a governed item, and merges one only a retired term governs", async () => {
      const [other] = await c`insert into themes(name, slug, level) values ('Gloomy', 'gloomy', 1) returning id`;
      await expect(merge("themes", ids.dark, other.id)).rejects.toThrow(
        "The book enrichment vocabulary governs the item being merged away. Retire its term in a new vocabulary version first.",
      );
      // The bleak theme's term retired in version 2: its item may merge away
      await merge("themes", ids.bleak, other.id);
      expect(await c`select id from themes where id = ${ids.bleak}`).toEqual([]);
      // A retired term follows its custom item into the kept one
      const [kept] = await c`insert into custom_taxonomy_items(family_id, name, slug) values (${ids.moods}, 'Wistful', 'wistful') returning id`;
      const [old] = await c`insert into custom_taxonomy_items(family_id, name, slug) values (${ids.moods}, 'Pensive', 'pensive') returning id`;
      const [retired] = await c`insert into enrichment_terms ${c({ dimension_id: ids.mood, key: "pensive", label: "Pensive", definition: "D", applies_when: "A", does_not_apply_when: "B", introduced_in: 1, retired_in: 2, custom_item_id: old.id, examples: JSON.stringify(OUTSIDE) })} returning id`;
      await merge("custom-taxonomy", old.id, kept.id);
      expect((await c`select custom_item_id from enrichment_terms where id = ${retired.id}`)[0].custom_item_id).toBe(kept.id);
      await expect(merge("custom-taxonomy", ids.melancholy, kept.id)).rejects.toThrow("governs the item being merged away");
    });
  });
});

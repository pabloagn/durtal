import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";

const url = process.env.DURTAL_ENRICHMENT_SERVICES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln462_enrichment_services")
    throw new Error("Enrichment service tests require disposable local sln462_enrichment_services");
}
const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
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
const effects = vi.hoisted(() => ({ recordActivity: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/cache", () => ({
  cached: (fn: unknown) => fn,
  invalidate: effects.invalidate,
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/activity/record", () => ({ recordActivity: effects.recordActivity }));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
import { vocabularySeedSchema, type VocabularySeed } from "@/lib/validations/enrichment";
import { applyVocabulary, planVocabulary, undoVocabulary } from "@/lib/enrichment/loader";
import { applyClaim, proposeClaims, type ProposalResult } from "@/lib/enrichment/claims";
import {
  claimNextEnrichmentJob,
  enqueueEnrichmentJob,
  failEnrichmentJob,
  finishEnrichmentJob,
  holdEnrichmentJob,
  releaseHeldEnrichmentJobs,
} from "@/lib/enrichment/jobs";
import {
  acceptEnrichmentClaims,
  createHumanEnrichmentClaim,
  getWorkEnrichment,
  rejectEnrichmentClaims,
  undoEnrichmentApplication,
} from "@/lib/actions/enrichment";
import { updateWorkTaxonomy } from "@/lib/actions/taxonomy";
import { replaceTaxonomyAssignments } from "@/lib/actions/taxonomy-families";
import { deleteEdition } from "@/lib/actions/editions";
import { GET as listWorks } from "@/app/api/works/route";

/*
 * SLN-462: the enrichment services, actions, vocabulary loader and job queue,
 * on the fixture vocabulary (src/__tests__/fixtures/enrichment/vocabulary.json).
 */

const FIXTURE = "src/__tests__/fixtures/enrichment/vocabulary.json";
const EXAMPLE_WORK = "7c2f1d52-1b8e-4c5a-9d3e-2f6a8b1c4e90";
const APPROVAL = "https://linear.app/sanctum-black/issue/SLN-461#comment-approval";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const fixture = (): VocabularySeed => vocabularySeedSchema.parse(JSON.parse(readFileSync(FIXTURE, "utf8")));

describe.skipIf(!url)("the enrichment services", () => {
  const c = client!;
  const conn = testDb as unknown as Db;
  const run = randomUUID();
  const load = (seed: VocabularySeed) =>
    testDb!.transaction((tx) => applyVocabulary(tx as unknown as Db, seed, { approvalUrl: APPROVAL, seedSha256: sha(JSON.stringify(seed)) }));
  const count = async (table: string) => (await c`select count(*)::int as n from ${c(table)}`)[0].n as number;
  const book = async (title: string, id?: string) => {
    const [w] = await c`insert into works ${c({ ...(id ? { id } : {}), title, slug: `${title.toLowerCase().replace(/\W+/g, "-")}-${randomUUID().slice(0, 8)}` })} returning id`;
    return w.id as string;
  };
  const source = async (workId: string, payload: Record<string, unknown>, provider = "wikidata") => {
    const json = JSON.stringify(payload);
    const [s] = await c`insert into source_records(entity_kind, work_id, provider, retrieved_at, payload, payload_hash, review_status, url)
      values ('book', ${workId}, ${provider}, now(), ${json}::jsonb, ${sha(json)}, 'accepted', 'https://www.wikidata.org/wiki/Q1') returning id`;
    return s.id as string;
  };
  const evidence = (sourceRecordId: string, excerpt: string, payloadPath: string[]) => ({
    locator: "payload" as const,
    sourceRecordId,
    extractorVersion: "map-v1",
    excerpt,
    payloadPath,
  });
  /** A proposal from an API answer that says `excerpt` at `path` */
  const proposal = (workId: string, dimension: string, value: Record<string, unknown>, sources: [string, string, string[]][], confidence = 0.8) => ({
    workId,
    dimension,
    value: value as { term: string },
    method: "api" as const,
    confidence,
    vocabularyVersion: 1,
    runId: run,
    evidence: sources.map(([s, excerpt, path]) => evidence(s, excerpt, path)),
  });
  const propose = async (...items: Parameters<typeof proposal>[]) => proposeClaims(items.map((i) => proposal(...i)), conn);
  const claimId = (r: ProposalResult) => ("claimId" in r ? r.claimId : expect.fail(`not a claim: ${JSON.stringify(r)}`));
  const fingerprint = async (workId: string, id: string) =>
    (await getWorkEnrichment(workId)).claims.find((x) => x.id === id)!.fingerprint;
  const item = async (table: string, slug: string) => (await c`select id from ${c(table)} where slug = ${slug}`)[0]?.id as string;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(() => {
    effects.recordActivity.mockClear();
    effects.invalidate.mockClear();
  });

  describe("the vocabulary loader", () => {
    it("plans without writing, stops on an unknown example work, and follows a merged one", async () => {
      const unknown = await planVocabulary(conn, fixture());
      expect(unknown.problems).toContain(`dimensions.tone.terms.dark: the example ${EXAMPLE_WORK} is not a book in the catalogue`);
      // The example was merged away into another book: the plan follows it
      const kept = await book("Kept example");
      await c`insert into harmonization_redirects(source_id, entity, target_id) values (${EXAMPLE_WORK}, 'works', ${kept})`;
      const plan = await planVocabulary(conn, fixture());
      expect(plan.problems).toEqual([]);
      expect(plan.writes.terms.find((t) => t.key === "dark")!.seed.examples[0]).toEqual({ workId: kept });
      expect(plan.dimensions.add).toHaveLength(9);
      expect(plan.terms.add).toHaveLength(8);
      for (const table of ["enrichment_vocabulary_versions", "enrichment_dimensions", "enrichment_terms", "enrichment_auto_accept_rules"])
        expect(await count(table), table).toBe(0);
    });

    it("refuses --apply without a recent backup or an approval link", () => {
      const script = (...args: string[]) => {
        try {
          execFileSync("pnpm", ["exec", "tsx", "--tsconfig", "tsconfig.json", "scripts/enrichment/vocabulary.ts", "--seed", FIXTURE, ...args], {
            env: { ...process.env, PREVIEW_DATABASE_URL: url! },
            stdio: "pipe",
            encoding: "utf8",
          });
          return "";
        } catch (error) {
          return String((error as { stderr?: string }).stderr);
        }
      };
      expect(script("--apply")).toContain("--apply needs --backup");
      const folder = mkdtempSync(join(tmpdir(), "sln462-"));
      const backup = join(folder, "live.dump");
      writeFileSync(backup, "PGDMP fake backup");
      expect(script("--apply", "--backup", backup)).toContain("--apply needs --approval");
    }, 60000);

    it("loads version 1: missing items in their family with category and parent, an existing one reused by slug, rules off", async () => {
      const [fast] = await c`insert into attributes(name, slug, category) values ('Fast', 'fast', 'pace') returning id`;
      const plan = await load(fixture());
      expect(plan.items.reuse).toEqual(["attributes/fast"]);
      expect(plan.items.create.sort()).toEqual(
        ["attributes/slow", "attributes/steady", "moods/joyful", "moods/melancholy", "themes/dark", "themes/gothic", "themes/light"].sort(),
      );
      const [dark] = await c`select id from themes where slug = 'dark'`;
      expect((await c`select parent_id from themes where slug = 'gothic'`)[0].parent_id).toBe(dark.id);
      expect((await c`select category from attributes where slug = 'slow'`)[0].category).toBe("pace");
      expect(await item("attributes", "fast")).toBe(fast.id);
      expect((await c`select is_system from taxonomy_families where slug = 'moods'`)[0].is_system).toBe(false);
      expect(await c`select d.key, r.basis, r.enabled from enrichment_auto_accept_rules r join enrichment_dimensions d on d.id = r.dimension_id order by d.key`).toEqual([
        { key: "tone", basis: "evaluation_gate", enabled: false },
        { key: "wikidata", basis: "exact_identifier_match", enabled: false },
      ]);
      expect((await c`select approval_url, seed_sha256 from enrichment_vocabulary_versions`)[0].approval_url).toBe(APPROVAL);
      expect(await count("enrichment_terms")).toBe(8);
    });

    it("turns off an enabled rule of a dimension a new version changes; undoing that version restores the old terms", async () => {
      await c`update enrichment_auto_accept_rules set enabled = true, approval_url = ${APPROVAL}, enabled_at = now(), gold_set_version = 1,
        gate_passed_at = now(), measured_precision = 0.97, sample_size = 60, minimum_sample = 50
        where dimension_id = (select id from enrichment_dimensions where key = 'tone')`;
      const v2 = fixture();
      v2.version = 2;
      v2.dimensions[0].terms[1].definition = "Warm, buoyant and hopeful.";
      const plan = await planVocabulary(conn, v2);
      expect(plan.problems).toEqual([]);
      expect(plan.terms.redefine).toEqual(["tone.light"]);
      expect(plan.rules.turnOff).toEqual(["tone"]);
      const [old] = await c`select id from enrichment_terms where key = 'light'`;
      await load(v2);
      expect((await c`select enabled from enrichment_auto_accept_rules r join enrichment_dimensions d on d.id = r.dimension_id where d.key = 'tone'`)[0].enabled).toBe(false);
      const [renewed] = await c`select id, system_item_id from enrichment_terms where key = 'light' and retired_in is null`;
      expect((await c`select retired_in, replaced_by_term_id, system_item_id from enrichment_terms where id = ${old.id}`)[0]).toEqual({
        retired_in: 2,
        replaced_by_term_id: renewed.id,
        system_item_id: renewed.system_item_id,
      });
      await testDb!.transaction((tx) => undoVocabulary(tx as unknown as Db, 2));
      expect(await c`select id from enrichment_terms where key = 'light' and retired_in is null`).toEqual([{ id: old.id }]);
      expect(await c`select version from enrichment_vocabulary_versions`).toEqual([{ version: 1 }]);
    });
  });

  describe("proposals", () => {
    let a: string, s1: string, s2: string;
    beforeAll(async () => {
      a = await book("Proposals");
      s1 = await source(a, { labels: { en: "Dark" }, year: "1951", title: "Los detectives salvajes" });
      s2 = await source(a, { subjects: ["Dark"], year: "1951" }, "open_library");
    });

    it("creates a value, adds a second source to it, and refuses what no rule allows", async () => {
      const [first] = await propose([a, "tone", { term: "dark" }, [[s1, "Dark", ["labels", "en"]]]]);
      expect(first.status).toBe("created");
      const [second] = await propose([a, "tone", { term: "dark" }, [[s2, "Dark", ["subjects", "0"]]], 0.9]);
      expect(second).toEqual({ status: "merged", claimId: claimId(first) });
      expect((await c`select confidence::float8 as confidence from enrichment_claims where id = ${claimId(first)}`)[0].confidence).toBe(0.9);
      expect(await c`select outlet from claim_evidence where claim_id = ${claimId(first)} order by outlet`).toEqual([{ outlet: "open_library" }, { outlet: "wikidata" }]);
      const refused = await proposeClaims(
        [
          proposal(a, "tone", { term: "sunny" }, [[s1, "Dark", ["labels", "en"]]]),
          { ...proposal(a, "tone", { term: "light" }, [[s1, "Dark", ["labels", "en"]]]), vocabularyVersion: 2 },
          proposal(a, "tone", { number: 3 }, [[s1, "Dark", ["labels", "en"]]]),
          proposal(a, "mood", { term: "joyful" }, [[s1, "Joyful", ["labels", "en"]]]),
        ],
        conn,
      );
      expect(refused).toEqual([
        { status: "refused", reason: "Unknown or retired term: sunny" },
        { status: "refused", reason: "Unknown or retired dimension: tone" },
        { status: "refused", reason: "A terms dimension takes a value of its own kind" },
        { status: "refused", reason: "The excerpt differs from the source's answer at its path" },
      ]);
      expect((await c`select count(*)::int as n from enrichment_claims c join enrichment_terms t on t.id = c.term_id where t.key = 'joyful'`)[0].n).toBe(0);
    });

    it("takes a human proposal only from Pablo's export", async () => {
      const human = { ...proposal(a, "mood", { term: "melancholy" }, [[s1, "Dark", ["labels", "en"]]]), method: "human" as const, confidence: 1, runId: undefined };
      expect(await proposeClaims([human], conn)).toEqual([{ status: "refused", reason: "A proposed human claim cites only Pablo's own export" }]);
      const exported = await source(a, { moods: ["melancholy"] }, "storygraph_export");
      const [ok] = await proposeClaims([{ ...human, evidence: [evidence(exported, "melancholy", ["moods", "0"])] }], conn);
      expect(ok.status).toBe("created");
    });

    it("skips a value accepted or rejected for good, one rejected on the same sources, and never one withdrawn", async () => {
      const [dark] = await c`select c.id from enrichment_claims c join enrichment_terms t on t.id = c.term_id where c.work_id = ${a} and t.key = 'dark'`;
      expect((await acceptEnrichmentClaims([{ claimId: dark.id, fingerprint: await fingerprint(a, dark.id) }])).failed).toEqual([]);
      expect(await propose([a, "tone", { term: "dark" }, [[s1, "Dark", ["labels", "en"]]]])).toEqual([{ status: "skipped", reason: "already accepted" }]);

      const [slow] = await propose([a, "pace", { term: "slow" }, [[s1, "Dark", ["labels", "en"]]]]);
      await rejectEnrichmentClaims([{ claimId: claimId(slow), fingerprint: await fingerprint(a, claimId(slow)), reason: "weak_evidence" }]);
      expect(await propose([a, "pace", { term: "slow" }, [[s1, "Dark", ["labels", "en"]]]])).toEqual([{ status: "skipped", reason: "rejected on the same sources" }]);
      expect((await propose([a, "pace", { term: "slow" }, [[s2, "Dark", ["subjects", "0"]]]]))[0].status).toBe("created");

      const [title] = await propose([a, "original_title", { text: "Los detectives salvajes" }, [[s1, "Los detectives salvajes", ["title"]]]]);
      await rejectEnrichmentClaims([{ claimId: claimId(title), fingerprint: await fingerprint(a, claimId(title)), reason: "wrong_value" }]);
      expect(await propose([a, "original_title", { text: "Los detectives salvajes" }, [[s2, "1951", ["year"]]]])).toEqual([
        { status: "skipped", reason: "rejected for good" },
      ]);

      const [year] = await propose([a, "composition_year", { number: 1951 }, [[s1, "1951", ["year"]]]]);
      await c`update enrichment_claims set status = 'rejected', decided_by = 'check', decided_at = now(), decision_reason = 'run_undone' where id = ${claimId(year)}`;
      expect((await propose([a, "composition_year", { number: 1951 }, [[s1, "1951", ["year"]]]]))[0].status).toBe("created");
    });

    it("ends two concurrent proposals of one value as one claim", async () => {
      const results = await Promise.all([
        proposeClaims([proposal(a, "mood", { term: "joyful" }, [[s1, "Dark", ["labels", "en"]]])].map((p) => ({ ...p, evidence: [evidence(s1, "1951", ["year"])] })), conn),
        proposeClaims([proposal(a, "mood", { term: "joyful" }, [[s2, "1951", ["year"]]])], conn),
      ]);
      expect(results.flat().map((r) => r.status).sort()).toEqual(["created", "merged"]);
      expect((await c`select count(*)::int as n from enrichment_claims c join enrichment_terms t on t.id = c.term_id where c.work_id = ${a} and t.key = 'joyful'`)[0].n).toBe(1);
    });
  });

  describe("accept, reject, edit and undo", () => {
    it("writes an accepted term's taxonomy link, which the library filter finds; undo removes it", async () => {
      const b = await book("Accepted");
      const s = await source(b, { labels: { en: "Dark" } });
      const [dark] = await propose([b, "tone", { term: "dark" }, [[s, "Dark", ["labels", "en"]]]]);
      const id = claimId(dark);
      expect((await acceptEnrichmentClaims([{ claimId: id, fingerprint: "0".repeat(32) }])).failed).toEqual([
        { claimId: id, reason: "The claim, its evidence or the book's value changed. Review it again." },
      ]);
      const accepted = await acceptEnrichmentClaims([{ claimId: id, fingerprint: await fingerprint(b, id) }]);
      expect(accepted.failed).toEqual([]);
      const theme = await item("themes", "dark");
      expect(await c`select theme_id from work_themes where work_id = ${b}`).toEqual([{ theme_id: theme }]);
      const [app] = await c`select before, after, applied_by, batch_id from enrichment_applications where claim_id = ${id}`;
      expect(app).toMatchObject({ applied_by: "pablo", batch_id: accepted.batchId, before: { value: { items: [] } }, after: { value: { items: [theme] } } });
      expect(effects.recordActivity).toHaveBeenCalledWith("work", b, "work.enrichment_applied", expect.anything());
      expect(effects.invalidate).toHaveBeenCalledWith("works");
      // The library and GET /api/works find it with the same total as the links
      const linked = (await c`select count(*)::int as n from work_themes where theme_id = ${theme}`)[0].n;
      const res = await listWorks(new NextRequest(`http://localhost/api/works?theme=${theme}`));
      const body = await res.json();
      expect(body.total).toBe(linked);
      expect(body.works.map((w: { id: string }) => w.id)).toContain(b);
      const undone = await undoEnrichmentApplication(accepted.applied[0].applicationId);
      expect(undone.failed).toEqual([]);
      expect(await c`select theme_id from work_themes where work_id = ${b}`).toEqual([]);
      expect((await c`select status from enrichment_claims where id = ${id}`)[0].status).toBe("proposed");
      expect(effects.recordActivity).toHaveBeenCalledWith("work", b, "work.enrichment_undone", expect.anything());
    });

    it("keeps one governed item on a single-value dimension, and undo puts back the one it replaced", async () => {
      const b = await book("Single value");
      const s = await source(b, { labels: { en: "Dark" } });
      const one = async (term: string) => claimId((await propose([b, "pace", { term }, [[s, "Dark", ["labels", "en"]]]]))[0]);
      const [slow, fast] = [await one("slow"), await one("fast")];
      const accept = async (id: string) => (await acceptEnrichmentClaims([{ claimId: id, fingerprint: await fingerprint(b, id) }])).applied[0].applicationId;
      await accept(slow);
      expect((await c`select status, superseded_by_claim_id from enrichment_claims where id = ${fast}`)[0]).toEqual({ status: "superseded", superseded_by_claim_id: slow });
      const steady = await one("steady");
      const replaced = await accept(steady);
      const links = async () => (await c`select a.slug from work_attributes w join attributes a on a.id = w.attribute_id where w.work_id = ${b}`).map((r) => r.slug);
      expect(await links()).toEqual(["steady"]);
      expect((await c`select status from enrichment_claims where id = ${slow}`)[0].status).toBe("superseded");
      await undoEnrichmentApplication(replaced);
      expect(await links()).toEqual(["slow"]);
      expect(await c`select id, status from enrichment_claims where id in (${slow}, ${steady}, ${fast}) order by status, id`).toEqual(
        [{ id: slow, status: "accepted" }, { id: steady, status: "proposed" }, { id: fast, status: "superseded" }].sort((x, y) => x.status.localeCompare(y.status) || x.id.localeCompare(y.id)),
      );
      // A value changed since its apply cannot be undone from that apply
      const again = await accept(steady);
      await c`delete from work_attributes where work_id = ${b}`;
      expect((await undoEnrichmentApplication(again)).failed[0].reason).toBe("The value changed since it was applied; undo it from its newer apply first");
    });

    it("reopens on undo only the superseded proposals that still have evidence", async () => {
      const b = await book("Lost evidence");
      const [edition] = await c`insert into editions(work_id, title) values (${b}, 'Edition') returning id`;
      const json = JSON.stringify({ labels: { en: "Dark" } });
      const [fromEdition] = await c`insert into source_records(entity_kind, edition_id, provider, retrieved_at, payload, payload_hash, review_status)
        values ('edition', ${edition.id}, 'wikidata', now(), ${json}::jsonb, ${sha(json)}, 'accepted') returning id`;
      const s = await source(b, { labels: { en: "Dark" } });
      const [slow] = await propose([b, "pace", { term: "slow" }, [[s, "Dark", ["labels", "en"]]]]);
      const [fast] = await propose([b, "pace", { term: "fast" }, [[fromEdition.id, "Dark", ["labels", "en"]]]]);
      const accepted = await acceptEnrichmentClaims([{ claimId: claimId(slow), fingerprint: await fingerprint(b, claimId(slow)) }]);
      expect((await c`select status from enrichment_claims where id = ${claimId(fast)}`)[0].status).toBe("superseded");
      // The edition goes, and with it the superseded proposal's only evidence
      await deleteEdition(edition.id);
      expect((await undoEnrichmentApplication(accepted.applied[0].applicationId)).failed).toEqual([]);
      expect((await c`select status from enrichment_claims where id = ${claimId(fast)}`)[0].status).toBe("superseded");
      expect((await c`select status from enrichment_claims where id = ${claimId(slow)}`)[0].status).toBe("proposed");
    });

    it("applies Pablo's edit at once, superseding the value it replaces; undo rejects it", async () => {
      const b = await book("Edited");
      const s = await source(b, { title: "Detectives" });
      const [open] = await propose([b, "original_title", { text: "Detectives" }, [[s, "Detectives", ["title"]]]]);
      const edit = await createHumanEnrichmentClaim({ workId: b, dimension: "original_title", value: { text: "Los detectives salvajes" } });
      expect((await c`select original_title from works where id = ${b}`)[0].original_title).toBe("Los detectives salvajes");
      expect((await c`select status, superseded_by_claim_id from enrichment_claims where id = ${claimId(open)}`)[0]).toEqual({
        status: "superseded",
        superseded_by_claim_id: edit.claimId,
      });
      expect(effects.recordActivity).toHaveBeenCalledWith("work", b, "work.enrichment_applied", expect.anything());
      await undoEnrichmentApplication(edit.applicationId);
      expect((await c`select original_title from works where id = ${b}`)[0].original_title).toBeNull();
      expect((await c`select status, decision_reason from enrichment_claims where id = ${edit.claimId}`)[0]).toEqual({ status: "rejected", decision_reason: "undone" });
      expect((await c`select status from enrichment_claims where id = ${claimId(open)}`)[0].status).toBe("proposed");
      const [film] = await c`insert into works(title, kind, original_language) values ('Film', 'film', null) returning id`;
      await expect(createHumanEnrichmentClaim({ workId: film.id, dimension: "original_title", value: { text: "Häxan" } })).rejects.toThrow("Book not found");
    });

    it("writes an identifier, refuses a second one and one owned by another book; a target without a writer refuses", async () => {
      const d = await book("Identified");
      const e = await book("Other");
      const ids = async (w: string, q: string) => {
        const s = await source(w, { id: q });
        return claimId((await propose([w, "wikidata", { text: q }, [[s, q, ["id"]]]]))[0]);
      };
      const accept = async (w: string, id: string) => acceptEnrichmentClaims([{ claimId: id, fingerprint: await fingerprint(w, id) }]);
      expect((await accept(d, await ids(d, "Q1"))).failed).toEqual([]);
      expect(await c`select entity_kind, provider, external_id from catalogue_identifiers where work_id = ${d}`).toEqual([
        { entity_kind: "book", provider: "wikidata", external_id: "Q1" },
      ]);
      expect((await accept(d, await ids(d, "Q2"))).failed[0].reason).toBe("This record already has an ID of this provider; undo it first");
      expect((await accept(e, await ids(e, "Q1"))).failed[0].reason).toBe("This ID already belongs to another record");
      const [edition] = await c`insert into editions(work_id, title) values (${d}, 'Edition') returning id`;
      const [person] = await c`insert into authors(name, slug) values ('Chris Andrews', ${randomUUID()}) returning id`;
      const s = await source(d, { translator: "Chris Andrews" });
      const [translator] = await proposeClaims(
        [{ ...proposal(d, "translator", { personId: person.id }, [[s, "Chris Andrews", ["translator"]]]), editionId: edition.id }],
        conn,
      );
      expect((await accept(d, claimId(translator))).failed[0].reason).toBe("No writer for edition.translator");
    });
  });

  describe("rules", () => {
    it("refuses a rule apply when off, below its minimum, on a human claim, over a value, after an undo, or over the daily cap", async () => {
      const [rule] = await c`select r.id from enrichment_auto_accept_rules r join enrichment_dimensions d on d.id = r.dimension_id where d.key = 'tone'`;
      const byRule = (id: string) => applyClaim(id, { by: "rule", ruleId: rule.id }, conn);
      const f = await book("Ruled");
      const s = await source(f, { labels: { en: "Dark" } });
      const [light] = await propose([f, "tone", { term: "light" }, [[s, "Dark", ["labels", "en"]]], 0.95]);
      await expect(byRule(claimId(light))).rejects.toThrow("The rule is off");
      await c`update enrichment_auto_accept_rules set enabled = true, enabled_at = now() where id = ${rule.id}`;
      const [gothic] = await propose([f, "tone", { term: "gothic" }, [[s, "Dark", ["labels", "en"]]], 0.5]);
      await expect(byRule(claimId(gothic))).rejects.toThrow("The claim's confidence is below the rule's minimum");
      const exported = await source(f, { moods: ["dark"] }, "storygraph_export");
      const [human] = await proposeClaims(
        [{ ...proposal(f, "tone", { term: "dark" }, []), method: "human", confidence: 1, runId: undefined, evidence: [evidence(exported, "dark", ["moods", "0"])] }],
        conn,
      );
      await expect(byRule(claimId(human))).rejects.toThrow("A rule never applies Pablo's own claim");
      // A link that is already there is the value already there
      await c`insert into work_themes(work_id, theme_id) values (${f}, ${await item("themes", "light")})`;
      await expect(byRule(claimId(light))).rejects.toThrow("A rule never replaces a value that is already there");
      await c`delete from work_themes where work_id = ${f}`;
      const applied = await byRule(claimId(light));
      expect((await c`select applied_by from enrichment_applications where id = ${applied.applicationId}`)[0].applied_by).toBe("rule");
      await undoEnrichmentApplication(applied.applicationId);
      await expect(byRule(claimId(light))).rejects.toThrow("An undone value waits for Pablo's decision");
      // Twenty rule applies in the last day: the cap is reached
      await c`insert into enrichment_applications (claim_id, work_id, dimension_id, target, before, after, applied_by, rule_id)
        select claim_id, work_id, dimension_id, target, before, after, 'rule', rule_id from enrichment_applications, generate_series(1, 19)
        where id = ${applied.applicationId}`;
      const g = await book("Capped");
      const sg = await source(g, { labels: { en: "Dark" } });
      const [capped] = await propose([g, "tone", { term: "dark" }, [[sg, "Dark", ["labels", "en"]]], 0.95]);
      await expect(byRule(claimId(capped))).rejects.toThrow("The daily cap on automatic applies is reached");
      await c`update enrichment_auto_accept_rules set enabled = false where id = ${rule.id}`;
    });
  });

  describe("hand edits", () => {
    it("turns a governed item added by hand into Pablo's claim and one removed into a rejection; an ungoverned item behaves as before", async () => {
      const h = await book("By hand");
      const s = await source(h, { labels: { en: "Dark" } });
      const [open] = await propose([h, "tone", { term: "light" }, [[s, "Dark", ["labels", "en"]]]]);
      const light = await item("themes", "light");
      const [loose] = await c`insert into themes(name, slug, level) values ('Loose', 'loose', 1) returning id`;
      await updateWorkTaxonomy(h, { themeIds: [light, loose.id] });
      const [mine] = await c`select id, method, status, decided_by from enrichment_claims where work_id = ${h} and method = 'human'`;
      expect(mine).toMatchObject({ method: "human", status: "accepted", decided_by: "pablo" });
      expect((await c`select status, superseded_by_claim_id from enrichment_claims where id = ${claimId(open)}`)[0]).toEqual({ status: "superseded", superseded_by_claim_id: mine.id });
      expect((await c`select note from enrichment_applications where claim_id = ${mine.id}`)[0].note).toBe("added by hand");
      await updateWorkTaxonomy(h, { themeIds: [loose.id] });
      expect((await c`select status, decision_reason, note from enrichment_claims where id = ${mine.id}`)[0]).toEqual({
        status: "rejected",
        decision_reason: "wrong_value",
        note: "removed by hand",
      });
      expect((await c`select count(*)::int as n from enrichment_applications where claim_id = ${mine.id}`)[0].n).toBe(2);
      expect(await propose([h, "tone", { term: "light" }, [[s, "Dark", ["labels", "en"]]]])).toEqual([{ status: "skipped", reason: "rejected for good" }]);
      expect((await c`select count(*)::int as n from enrichment_claims where work_id = ${h}`)[0].n).toBe(2);
    });

    it("does the same for a custom family edited in place on the book page", async () => {
      const m = await book("Moody");
      const s = await source(m, { labels: { en: "Melancholy" } });
      const id = claimId((await propose([m, "mood", { term: "melancholy" }, [[s, "Melancholy", ["labels", "en"]]]]))[0]);
      expect((await acceptEnrichmentClaims([{ claimId: id, fingerprint: await fingerprint(m, id) }])).failed).toEqual([]);
      const mood = async (slug: string) =>
        (await c`select i.id from custom_taxonomy_items i join taxonomy_families f on f.id = i.family_id where f.slug = 'moods' and i.slug = ${slug}`)[0].id as string;
      expect(await c`select item_id from custom_taxonomy_item_works where work_id = ${m}`).toEqual([{ item_id: await mood("melancholy") }]);
      const edit = (itemIds: string[]) => replaceTaxonomyAssignments({ familySlug: "moods", kind: "book", level: "work", ownerId: m, itemIds });
      await edit([]);
      expect((await c`select status, decision_reason, note from enrichment_claims where id = ${id}`)[0]).toEqual({
        status: "rejected",
        decision_reason: "wrong_value",
        note: "removed by hand",
      });
      await edit([await mood("joyful")]);
      const [mine] = await c`select c.id, c.status, c.decided_by, t.key from enrichment_claims c join enrichment_terms t on t.id = c.term_id
        where c.work_id = ${m} and c.method = 'human'`;
      expect(mine).toMatchObject({ status: "accepted", decided_by: "pablo", key: "joyful" });
      expect(await c`select applied_by, note from enrichment_applications where claim_id = ${mine.id}`).toEqual([{ applied_by: "pablo", note: "added by hand" }]);
    });
  });

  describe("jobs", () => {
    it("never gives two workers one job; an enqueue during a run queues it again when it finishes", async () => {
      const [w1, w2] = [await book("Job one"), await book("Job two")];
      await enqueueEnrichmentJob({ workId: w1, kind: "identity", reason: "created" }, conn);
      await enqueueEnrichmentJob({ workId: w2, kind: "identity", reason: "created" }, conn);
      const scope = { kinds: ["identity" as const], workIds: [w1, w2] };
      const [x, y] = await Promise.all([
        claimNextEnrichmentJob({ worker: "a", ...scope }, conn),
        claimNextEnrichmentJob({ worker: "b", ...scope }, conn),
      ]);
      expect(x && y && x.id !== y.id).toBe(true);
      const again = await enqueueEnrichmentJob({ workId: x!.workId, kind: "identity", reason: "manual", dimensions: ["wikidata"] }, conn);
      expect(again).toMatchObject({ id: x!.id, rerun: true, status: "running" });
      const finished = await finishEnrichmentJob({ id: x!.id, worker: "a", outcome: { result: "resolved" } }, conn);
      expect(finished).toMatchObject({ status: "queued", rerun: false, payload: { outcome: { result: "resolved" }, dimensions: ["wikidata"] } });
      expect(await claimNextEnrichmentJob({ worker: "c", kinds: ["identity"], jobIds: [y!.id] }, conn)).toBeNull();
    });

    it("claims an abandoned job again after 30 minutes, counting each claim, and fails it on the fifth", async () => {
      const w = await book("Abandoned");
      const job = (await enqueueEnrichmentJob({ workId: w, kind: "facts", reason: "created" }, conn))!;
      const claim = () => claimNextEnrichmentJob({ worker: "w", kinds: ["facts"], jobIds: [job.id] }, conn);
      expect((await claim())!.attempts).toBe(1);
      expect(await claim()).toBeNull();
      for (let attempt = 2; attempt <= 5; attempt++) {
        await c`update enrichment_jobs set locked_at = now() - interval '31 minutes' where id = ${job.id}`;
        expect((await claim())!.attempts).toBe(attempt);
      }
      await c`update enrichment_jobs set locked_at = now() - interval '31 minutes' where id = ${job.id}`;
      expect(await claim()).toBeNull();
      expect((await c`select status, last_error from enrichment_jobs where id = ${job.id}`)[0]).toEqual({ status: "failed", last_error: "abandoned lease" });
    });

    it("retries a failure after 2^attempts minutes, fails it for good after five, and gives a hold its attempt back", async () => {
      const w = await book("Failing");
      const job = (await enqueueEnrichmentJob({ workId: w, kind: "length", reason: "created" }, conn))!;
      const claim = () => claimNextEnrichmentJob({ worker: "w", kinds: ["length"], jobIds: [job.id] }, conn);
      await claim();
      const failed = (await failEnrichmentJob({ id: job.id, worker: "w", error: new Error("GET https://api.example.org/?key=SECRET failed") }, conn))!;
      expect(failed.status).toBe("queued");
      expect(failed.lastError).not.toContain("SECRET");
      expect((await c`select round(extract(epoch from run_after - now()) / 60)::int as minutes from enrichment_jobs where id = ${job.id}`)[0].minutes).toBe(2);
      await c`update enrichment_jobs set run_after = now() where id = ${job.id}`;
      await claim();
      expect((await holdEnrichmentJob({ id: job.id, worker: "w", reason: "quota" }, conn))!).toMatchObject({ status: "held", attempts: 1 });
      expect(await releaseHeldEnrichmentJobs("length", conn)).toBe(1);
      for (let attempt = 2; attempt <= 5; attempt++) {
        await c`update enrichment_jobs set run_after = now() where id = ${job.id}`;
        await claim();
        await failEnrichmentJob({ id: job.id, worker: "w", error: "boom" }, conn);
      }
      expect((await c`select status, attempts from enrichment_jobs where id = ${job.id}`)[0]).toEqual({ status: "failed", attempts: 5 });
    });

    it("keeps a book's cost ceiling held, and a claim with ids takes only those", async () => {
      const [w1, w2] = [await book("Held one"), await book("Held two")];
      const j1 = (await enqueueEnrichmentJob({ workId: w1, kind: "research", reason: "research" }, conn))!;
      const j2 = (await enqueueEnrichmentJob({ workId: w2, kind: "research", reason: "research" }, conn))!;
      await claimNextEnrichmentJob({ worker: "w", kinds: ["research"], jobIds: [j1.id] }, conn);
      await claimNextEnrichmentJob({ worker: "w", kinds: ["research"], workIds: [w2] }, conn);
      await holdEnrichmentJob({ id: j1.id, worker: "w", reason: "work_cost_ceiling" }, conn);
      await holdEnrichmentJob({ id: j2.id, worker: "w", reason: "budget" }, conn);
      expect(await releaseHeldEnrichmentJobs(undefined, conn)).toBe(1);
      expect(await c`select status, held_reason from enrichment_jobs where id in (${j1.id}, ${j2.id}) order by status`).toEqual([
        { status: "held", held_reason: "work_cost_ceiling" },
        { status: "queued", held_reason: null },
      ]);
    });

    it("starts a rerun with its attempts back at zero, and a hold drops a pending rerun", async () => {
      const w = await book("Rerun");
      const job = (await enqueueEnrichmentJob({ workId: w, kind: "popularity", reason: "created" }, conn))!;
      const claim = () => claimNextEnrichmentJob({ worker: "w", kinds: ["popularity"], jobIds: [job.id] }, conn);
      const rerun = () => enqueueEnrichmentJob({ workId: w, kind: "popularity", reason: "manual" }, conn);
      for (let run = 1; run <= 5; run++) {
        expect((await claim())!.attempts).toBe(1);
        await rerun();
        expect(await finishEnrichmentJob({ id: job.id, worker: "w" }, conn)).toMatchObject({ status: "queued", attempts: 0 });
      }
      await claim();
      expect(await failEnrichmentJob({ id: job.id, worker: "w", error: "boom" }, conn)).toMatchObject({ status: "queued", attempts: 1 });
      await c`update enrichment_jobs set run_after = now() where id = ${job.id}`;
      await claim();
      await rerun();
      expect(await holdEnrichmentJob({ id: job.id, worker: "w", reason: "quota" }, conn)).toMatchObject({ status: "held", rerun: false });
      await releaseHeldEnrichmentJobs("popularity", conn);
      await claim();
      expect(await finishEnrichmentJob({ id: job.id, worker: "w" }, conn)).toMatchObject({ status: "done" });
    });
  });

  describe("undoing a version", () => {
    it("refuses while version 1 is used, and then undoes it completely", async () => {
      const undo = () => testDb!.transaction((tx) => undoVocabulary(tx as unknown as Db, 1));
      await expect(undo()).rejects.toThrow(/Version 1 is used by \d+ claims/);
      await c`delete from enrichment_claims`;
      await expect(undo()).rejects.toThrow("An item version 1 created has links; remove them first");
      await c`delete from work_themes`;
      await c`delete from work_attributes`;
      await c`delete from custom_taxonomy_item_works`;
      const fast = await item("attributes", "fast");
      const result = await undo();
      expect(result.items).toBe(7);
      for (const table of ["enrichment_vocabulary_versions", "enrichment_dimensions", "enrichment_terms", "enrichment_auto_accept_rules"])
        expect(await count(table), table).toBe(0);
      expect(await c`select slug from themes where slug in ('dark', 'light', 'gothic')`).toEqual([]);
      expect(await item("attributes", "fast")).toBe(fast);
      expect(await c`select id from taxonomy_families where slug = 'moods'`).toEqual([]);
    });
  });
});

import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
const url = process.env.DURTAL_PUBLISHER_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln319_test"
  )
    throw new Error("Publisher tests require disposable local sln319_test");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, p) => {
        if (!testDb) throw new Error("Local test DB required");
        return Reflect.get(testDb, p);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  invalidate: vi.fn(),
  CACHE_TAGS: { works: "works", editions: "editions", orders: "orders" },
}));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/s3/covers", () => ({ processAndUploadCover: vi.fn() }));
import {
  fulfilTargetWithCopy,
  getPublishers,
  savePublisher,
  getPublisherCatalogue,
  getEditionPublisherLinks,
  setEditionPublisherLinks,
  resetEditionPublisherLinks,
  createAcquisitionTarget,
  getAcquisitionTargets,
  cancelAcquisitionTarget,
  getOrderAcquisitionOptions,
  searchPublisherOptions,
  createPublisherFromName,
  getUnmatchedEditionNames,
} from "@/lib/actions/publishers";
import {
  getPublisherNameInbox,
  getPublisherSuggestionSummary,
  resolvePublisherNames,
  restorePublisherName,
  applySafePublisherDecisions,
  undoAutomaticPublisherDecision,
} from "@/lib/actions/publisher-names";
import { applyAutomaticDecisions } from "@/lib/publishers/resolution";
import { applyTaxonomy, undoTaxonomyRun } from "@/lib/publishers/taxonomy-apply";
import type { HouseSpec } from "@/lib/publishers/taxonomy";
import { createEdition, updateEdition } from "@/lib/actions/editions";
import {
  applyMatch,
  previewMatch,
  previewMatchHouses,
} from "@/lib/actions/match";
import {
  createOrder,
  updateOrderStatus,
  updateOrder,
} from "@/lib/actions/orders";
import { getWorks, getWorkCount } from "@/lib/actions/works";
import { getWorksForTimeline } from "@/lib/actions/work-timeline";

describe.skipIf(!url)(
  "publisher identities and acquisition targets with PostgreSQL",
  () => {
    const db = testDb!;
    beforeAll(async () => {
      await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
    });
    afterAll(async () => {
      await client?.end();
    });
    beforeEach(async () => {
      await db.execute(
        sql`truncate works, authors, publishing_houses, locations, publisher_specialties, ignored_publisher_names cascade`,
      );
      vi.clearAllMocks();
    });
    async function work(title = "A book") {
      return (
        await db
          .insert(schema.works)
          .values({ title, catalogueStatus: "accessioned", originalYear: 1944 })
          .returning()
      )[0];
    }
    async function publisher(name = "NYRB", country = "United States") {
      return savePublisher({ name, country });
    }
    async function edition(workId: string, name: string) {
      return createEdition({ workId, title: "Edition", publisher: name });
    }
    /** An edition written straight to the table: no automatic decision runs */
    async function raw(workId: string, name: string, isbn13?: string) {
      return (
        await db
          .insert(schema.editions)
          .values({ workId, title: "A book", publisher: name, isbn13 })
          .returning()
      )[0];
    }
    /** A valid ISBN-13 from its first 12 digits */
    function isbn(first12: string) {
      const sum = [...first12].reduce((n, d, i) => n + Number(d) * (i % 2 ? 3 : 1), 0);
      return first12 + ((10 - (sum % 10)) % 10);
    }
    async function own(editionId: string) {
      const [location] = await db
        .insert(schema.locations)
        .values({ name: "Test shelf", type: "physical" })
        .returning();
      return (
        await db
          .insert(schema.instances)
          .values({ editionId, locationId: location.id })
          .returning()
      )[0];
    }
    it("matches exact names and approved aliases across imports without losing raw text", async () => {
      const p = await publisher();
      const w = await work();
      const e = await edition(w.id, "  nyrb  ");
      expect(
        (await getEditionPublisherLinks(e.id)).map((x) => x.publisher.id),
      ).toEqual([p.id]);
      await savePublisher(
        { name: "NYRB", aliases: ["New York Review Books"] },
        p.id,
      );
      await updateEdition(e.id, { publisher: "New York Review Books" });
      expect((await getEditionPublisherLinks(e.id))[0].publisher.id).toBe(p.id);
      expect(
        (
          await db
            .select()
            .from(schema.editions)
            .where(eq(schema.editions.id, e.id))
        )[0].publisher,
      ).toBe("New York Review Books");
    });
    it("finds publishers by name, alias and accents, and creates one from a typed name", async () => {
      const nyrb = await savePublisher({
        name: "New York Review Books (NYRB)",
        aliases: ["NYRB Classics"],
      });
      await savePublisher({ name: "Éditions de Minuit" });
      expect((await searchPublisherOptions("new york review"))[0].id).toBe(
        nyrb.id,
      );
      expect((await searchPublisherOptions("nyrb classics"))[0].id).toBe(
        nyrb.id,
      );
      expect((await searchPublisherOptions("editions minuit"))[0].name).toBe(
        "Éditions de Minuit",
      );
      expect(await searchPublisherOptions("   ")).toEqual([]);
      expect(await searchPublisherOptions("new york", ["imprint"])).toEqual([]);
      const created = await createPublisherFromName("Wakefield Press");
      expect(created).toMatchObject({
        name: "Wakefield Press",
        kind: "publisher",
        parentName: null,
      });
      const e = await edition((await work()).id, "Wakefield Press");
      expect((await getEditionPublisherLinks(e.id))[0].publisher.id).toBe(
        created.id,
      );
    });
    it("saves an unmatched name as an alias and links every unconfirmed edition with it", async () => {
      const nyrb = await publisher("New York Review Books (NYRB)");
      const w = await work();
      const a = await raw(w.id, "New York Review of Books");
      const b = await raw(w.id, "  new york review of books ");
      const kept = await raw(w.id, "New York Review of Books");
      await setEditionPublisherLinks(kept.id, []);
      expect(await getUnmatchedEditionNames(a.id)).toEqual([
        { name: "New York Review of Books", others: 1 },
      ]);
      expect(
        await setEditionPublisherLinks(
          a.id,
          [nyrb.id],
          ["New York Review of Books"],
        ),
      ).toEqual({ linkedElsewhere: 1 });
      expect((await getEditionPublisherLinks(b.id))[0].publisher.id).toBe(
        nyrb.id,
      );
      // An explicit empty choice stays empty
      expect(await getEditionPublisherLinks(kept.id)).toEqual([]);
      expect(await getUnmatchedEditionNames(a.id)).toEqual([]);
      // A later import with the same name links by itself
      const later = await edition(w.id, "NEW YORK REVIEW OF BOOKS");
      expect((await getEditionPublisherLinks(later.id))[0].publisher.id).toBe(
        nyrb.id,
      );
    });
    it("never adds an alias that is already a name, is not the edition's, or has two houses", async () => {
      const penguin = await publisher("Penguin"),
        prh = await publisher("Penguin Random House");
      const w = await work();
      const e = await edition(w.id, "Penguin");
      const other = await edition(w.id, "Penguin");
      await expect(
        setEditionPublisherLinks(e.id, [prh.id], ["Penguin"]),
      ).rejects.toThrow();
      await expect(
        setEditionPublisherLinks(e.id, [prh.id], ["Some other name"]),
      ).rejects.toThrow();
      const copub = await edition(w.id, "Penguin and friends");
      await expect(
        setEditionPublisherLinks(
          copub.id,
          [penguin.id, prh.id],
          ["Penguin and friends"],
        ),
      ).rejects.toThrow();
      expect((await getEditionPublisherLinks(other.id))[0].publisher.id).toBe(
        penguin.id,
      );
      expect(await db.select().from(schema.publisherAliases)).toHaveLength(0);
    });
    it("stores one language code and rejects languages it cannot resolve", async () => {
      await db
        .insert(schema.languages)
        .values([
          { name: "English", iso6391: "en", iso6392: "eng", iso6393: "eng" },
          { name: "French", iso6391: "fr", iso6392: "fre/fra", iso6393: "fra" },
          { name: "Ancient Greek", iso6392: "grc", iso6393: "grc" },
        ])
        .onConflictDoNothing();
      const w = await work();
      const language = async (id: string) =>
        (
          await db
            .select({ language: schema.editions.language })
            .from(schema.editions)
            .where(eq(schema.editions.id, id))
        )[0].language;
      const e = await createEdition({
        workId: w.id,
        title: "Edition",
        language: "English",
      });
      expect(await language(e.id)).toBe("en");
      await updateEdition(e.id, { language: "fre" });
      expect(await language(e.id)).toBe("fr");
      await updateEdition(e.id, { language: "Ancient Greek" });
      expect(await language(e.id)).toBe("grc");
      // A code the reference table does not list keeps its form
      await updateEdition(e.id, { language: "tlh" });
      expect(await language(e.id)).toBe("tlh");
      await expect(
        updateEdition(e.id, { language: "Klingon" }),
      ).rejects.toThrow();
      await db
        .update(schema.works)
        .set({ originalLanguage: "en_GB" })
        .where(eq(schema.works.id, w.id));
      expect(
        (
          await db
            .select({ l: schema.works.originalLanguage })
            .from(schema.works)
            .where(eq(schema.works.id, w.id))
        )[0].l,
      ).toBe("en");
    });
    it("groups names without a house, suggests by similar name, and links every edition with one decision", async () => {
      const nyrb = await publisher("New York Review Books (NYRB)");
      const w = await work();
      const make = (name: string, isbn13: string) => raw(w.id, name, isbn13);
      const a = await make("New York Review of Books", "9781590176689");
      const b = await make("new york review of books", "9781681371368");
      const door = await make("Random House Publishing Services", "9781590178010");
      const inbox = await getPublisherNameInbox();
      expect(inbox.total).toBe(2);
      const row = inbox.rows[0];
      expect(row).toMatchObject({ name: "New York Review of Books", candidates: 0 });
      expect(row.editions.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
      expect(row.suggestions).toEqual([
        expect.objectContaining({ via: "name", publisher: expect.objectContaining({ id: nyrb.id }) }),
      ]);
      expect(row.prefixes).toEqual(
        expect.arrayContaining([
          { digits: "978159017", label: "978-1-59017", reach: 1 },
          { digits: "978168137", label: "978-1-68137", reach: 0 },
        ]),
      );
      expect(await getPublisherSuggestionSummary(nyrb.id)).toEqual({ names: 1, editions: 2 });
      const result = await resolvePublisherNames([
        { key: row.key, action: "link", publisherId: nyrb.id, usePrefixes: true },
      ]);
      expect(result).toMatchObject({ linked: 2, aliases: 1 });
      expect(result.prefixes.sort()).toEqual(["978-1-59017", "978-1-68137"]);
      // The distributor's edition links through the NYRB ISBN prefix
      for (const e of [a, b, door])
        expect((await getEditionPublisherLinks(e.id))[0].publisher.id).toBe(nyrb.id);
      expect((await getPublisherNameInbox()).total).toBe(0);
      // A later import links by name, and a new ISBN with a distributor's name by prefix
      const later = await make("NEW YORK REVIEW OF BOOKS", "9781590177235");
      expect((await getEditionPublisherLinks(later.id))[0].publisher.id).toBe(nyrb.id);
    });
    it("suggests by ISBN prefix without saving a distributor's name, and marks names as not publishers", async () => {
      const classics = await publisher("Penguin Classics");
      const w = await work();
      await createEdition({ workId: w.id, title: "Linked", publisher: "Penguin Classics", isbn13: "9780141439518" });
      const e = await createEdition({ workId: w.id, title: "Unlinked", publisher: "Penguin Books Ltd", isbn13: "9780143039433" });
      const noIsbn = await createEdition({ workId: w.id, title: "No ISBN", publisher: "Printed for the author" });
      const inbox = await getPublisherNameInbox();
      const row = inbox.rows.find((r) => r.name === "Penguin Books Ltd")!;
      expect(row.suggestions).toEqual([
        expect.objectContaining({ via: "isbn", publisher: expect.objectContaining({ id: classics.id }) }),
      ]);
      expect(row.suggestions[0].reason).toContain("978-0-14");
      await resolvePublisherNames([{ key: row.key, action: "link", publisherId: classics.id }]);
      expect((await getEditionPublisherLinks(e.id))[0].publisher.id).toBe(classics.id);
      expect(await db.select().from(schema.publisherAliases)).toHaveLength(0);
      const other = (await getPublisherNameInbox()).rows.find((r) => r.name === "Printed for the author")!;
      await resolvePublisherNames([{ key: other.key, action: "ignore" }]);
      const after = await getPublisherNameInbox();
      expect(after.total).toBe(0);
      expect(after.ignored).toEqual([{ key: other.key, name: "Printed for the author" }]);
      expect(await getEditionPublisherLinks(noIsbn.id)).toEqual([]);
      await restorePublisherName(other.key);
      expect((await getPublisherNameInbox()).total).toBe(1);
    });
    it("creates a house from a name and confirms ambiguous names edition by edition", async () => {
      const us = await publisher("Wakefield Press"),
        au = await publisher("Wakefield Press", "Australia");
      const w = await work();
      const x = await edition(w.id, "Wakefield Press");
      const y = await edition(w.id, "Dedalus Limited");
      const inbox = await getPublisherNameInbox();
      const ambiguous = inbox.rows.find((r) => r.name === "Wakefield Press")!;
      expect(ambiguous.candidates).toBe(2);
      const dedalus = inbox.rows.find((r) => r.name === "Dedalus Limited")!;
      const result = await resolvePublisherNames([
        { key: ambiguous.key, action: "link", publisherId: au.id },
        { key: dedalus.key, action: "create" },
      ]);
      // A created house drops "Limited"; the source spelling stays its alias
      expect(result.created).toEqual(["Dedalus"]);
      expect((await getEditionPublisherLinks(x.id)).map((l) => l.publisher.id)).toEqual([au.id]);
      expect((await getEditionPublisherLinks(y.id))[0].publisher.name).toBe("Dedalus");
      expect((await db.select().from(schema.publisherAliases)).map((a) => a.name)).toEqual([
        "Dedalus Limited",
      ]);
      expect(us.id).not.toBe(au.id);
    });
    it("links a similar name and creates a clean new house automatically when a book is added", async () => {
      const nyrb = await publisher("New York Review Books (NYRB)");
      const w = await work();
      const add = (name: string, isbn13?: string) =>
        createEdition({ workId: w.id, title: "A book", publisher: name, isbn13 });
      const a = await add("New York Review of Books", "9781590176689");
      expect((await getEditionPublisherLinks(a.id))[0].publisher.id).toBe(nyrb.id);
      const v = await add("VALANCOURT BOOKS LTD", isbn("978194391085"));
      expect((await getEditionPublisherLinks(v.id))[0].publisher.name).toBe("Valancourt Books");
      expect(
        (await db.select().from(schema.publisherAutoDecisions))
          .map((d) => [d.name, d.action])
          .sort(),
      ).toEqual([
        ["New York Review of Books", "alias"],
        ["VALANCOURT BOOKS LTD", "create"],
      ]);
      // Later books with either spelling link to the same houses, and no house is added
      const v2 = await add("Valancourt Books Ltd", isbn("978194391086"));
      const a2 = await add("new york review of books", "9781681371368");
      expect((await getEditionPublisherLinks(v2.id))[0].publisher.name).toBe("Valancourt Books");
      expect((await getEditionPublisherLinks(a2.id))[0].publisher.id).toBe(nyrb.id);
      expect(await db.select().from(schema.publishingHouses)).toHaveLength(2);
      // No ISBN rule is saved automatically
      expect(await db.select().from(schema.publisherIsbnPrefixes)).toHaveLength(0);
    });
    it("holds distributors, placeholders, the author's name, related names and unconfirmed ISBNs", async () => {
      await publisher("Bloomsbury Publishing");
      await publisher("Penguin Classics");
      const w = await work();
      const [author] = await db.insert(schema.authors).values({ name: "Jane Doe" }).returning();
      await db.insert(schema.workAuthors).values({ workId: w.id, authorId: author.id });
      await createEdition({ workId: w.id, title: "Linked", publisher: "Penguin Classics", isbn13: "9780141439518" });
      const cases: [string, string | undefined, string][] = [
        ["Random House Publishing Services", isbn("978159017801"), "Looks like a distributor"],
        ["CreateSpace Independent Publishing Platform", isbn("978150300000"), "A self-publishing or print-on-demand platform"],
        ["Unknown", isbn("978150400000"), "A placeholder, not a publisher"],
        ["Jane Doe", isbn("978150500000"), "Same as the author: may be self-published"],
        ["Vintage/Ebury (a Division of Random", isbn("978178487000"), "Names a parent company"],
        ["Bloomsbury Paperbacks", isbn("978074750000"), "May belong to Bloomsbury Publishing"],
        ["Penguin Adult", "9780143039433", "Its ISBN belongs to Penguin Classics under another name"],
        ["Brand New House", undefined, "A book with this name has no valid ISBN to confirm it"],
      ];
      for (const [name, code] of cases)
        await createEdition({ workId: w.id, title: "A book", publisher: name, isbn13: code });
      expect(await db.select().from(schema.publishingHouses)).toHaveLength(2);
      expect(await db.select().from(schema.publisherAutoDecisions)).toHaveLength(0);
      const plans = new Map(
        (await getPublisherNameInbox({ perPage: 96 })).rows.map((r) => [r.name, r.automatic]),
      );
      for (const [name, , reason] of cases)
        expect(plans.get(name), name).toEqual({ action: "hold", reason });
    });
    it("holds a name spread over many ISBN publishers or sharing an ISBN with another new name", async () => {
      const w = await work();
      await raw(w.id, "Spread Label", isbn("978150600000"));
      await raw(w.id, "Spread Label", isbn("978178487001"));
      await raw(w.id, "Spread Label", isbn("978094765000"));
      await raw(w.id, "Twin Press One", isbn("978190600000"));
      await raw(w.id, "Twin Press Two", isbn("978190600001"));
      const result = await applyAutomaticDecisions();
      expect(result.created).toEqual([]);
      const plans = new Map((await getPublisherNameInbox()).rows.map((r) => [r.name, r.automatic]));
      expect(plans.get("Spread Label")).toEqual({
        action: "hold",
        reason: "Its books use 3 ISBN publishers: may be a distributor",
      });
      expect(plans.get("Twin Press One")?.action).toBe("hold");
      expect((plans.get("Twin Press One") as { reason: string }).reason).toMatch(/^Shares ISBN .* with “Twin Press Two”$/);
    });
    it("makes one house for spellings of one new publisher and holds close names and other books", async () => {
      const w = await work();
      await raw(w.id, "Maclehose", isbn("978085705000"));
      await raw(w.id, "MacLehose Press", isbn("978085705001"));
      await raw(w.id, "Seix Barral", isbn("978843220000"));
      await raw(w.id, "Seix Barral - Argentina", isbn("978950731000"));
      await db.insert(schema.editions).values({
        workId: w.id,
        title: "Sports Nutrition: A Handbook for Professionals",
        publisher: "Wrong Book Press",
        isbn13: isbn("978088091000"),
      });
      const plans = new Map((await getPublisherNameInbox()).rows.map((r) => [r.name, r.automatic]));
      expect(plans.get("MacLehose Press")).toMatchObject({ action: "create", name: "Maclehose", sameAs: "maclehose" });
      expect(plans.get("Seix Barral")).toEqual({
        action: "hold",
        reason: "Close to another new name “Seix Barral - Argentina”: may be one publisher",
      });
      expect(plans.get("Wrong Book Press")).toEqual({
        action: "hold",
        reason: "The book data may describe another book (“Sports Nutrition: A Handbook for Professionals”)",
      });
      const result = await applyAutomaticDecisions();
      expect(result.created).toEqual([{ name: "Maclehose", from: "Maclehose" }]);
      expect(result.aliases).toEqual([{ name: "MacLehose Press", publisher: "Maclehose" }]);
      expect(result.linked).toBe(2);
      expect(await db.select().from(schema.publishingHouses)).toHaveLength(1);
    });
    it("reports a dry run, and stops creating houses after the daily limit", async () => {
      const w = await work();
      await raw(w.id, "Apocalypse Party", isbn("978173320000"));
      const dry = await applyAutomaticDecisions({ dryRun: true });
      expect(dry.created).toEqual([{ name: "Apocalypse Party", from: "Apocalypse Party" }]);
      expect(await db.select().from(schema.publishingHouses)).toHaveLength(0);
      await db.insert(schema.publisherAutoDecisions).values(
        Array.from({ length: 20 }, (_, i) => ({
          nameKey: `earlier ${i}`,
          name: `Earlier ${i}`,
          action: "create",
          reason: "test",
          editionCount: 1,
        })),
      );
      const e = await createEdition({ workId: w.id, title: "A book", publisher: "Piatkus Books", isbn13: isbn("978074995000") });
      expect(await getEditionPublisherLinks(e.id)).toEqual([]);
      expect(await db.select().from(schema.publishingHouses)).toHaveLength(0);
      // The inbox still applies it on request, without the daily limit
      const result = await applySafePublisherDecisions();
      expect(result.created.map((c) => c.name).sort()).toEqual(["Apocalypse Party", "Piatkus Books"]);
    });
    it("undoes an automatic house or alias, and never decides that name automatically again", async () => {
      const w = await work();
      const e = await createEdition({ workId: w.id, title: "A book", publisher: "Apocalypse Party", isbn13: isbn("978173320000") });
      const [created] = await db.select().from(schema.publisherAutoDecisions);
      const other = await raw(w.id, "Something else");
      await setEditionPublisherLinks(other.id, [created.publisherId!]);
      await expect(undoAutomaticPublisherDecision(created.id)).rejects.toThrow(/linked to it by hand/);
      await setEditionPublisherLinks(other.id, []);
      await undoAutomaticPublisherDecision(created.id);
      expect(await db.select().from(schema.publishingHouses)).toHaveLength(0);
      expect(await getEditionPublisherLinks(e.id)).toEqual([]);
      await updateEdition(e.id, { publisher: "Apocalypse Party" });
      expect(await db.select().from(schema.publishingHouses)).toHaveLength(0);
      expect((await getPublisherNameInbox()).rows[0].automatic).toEqual({
        action: "hold",
        reason: "Decided automatically before, then undone: left to you",
      });
      const nyrb = await publisher("New York Review Books (NYRB)");
      const a = await createEdition({ workId: w.id, title: "A book", publisher: "New York Review of Books", isbn13: "9781590176689" });
      const alias = (await db.select().from(schema.publisherAutoDecisions)).find((d) => d.action === "alias")!;
      await undoAutomaticPublisherDecision(alias.id);
      expect(await getEditionPublisherLinks(a.id)).toEqual([]);
      expect(await db.select().from(schema.publisherAliases)).toHaveLength(0);
      expect(nyrb.id).toBeTruthy();
    });
    it("keeps group → publisher → imprint, logs moves, and rolls pages up through every level", async () => {
      const group = await savePublisher({ name: "Test Group", kind: "group" });
      const pub = await savePublisher({ name: "Test Publisher", kind: "publisher", parentId: group.id });
      const other = await savePublisher({ name: "Other Publisher", kind: "publisher", parentId: group.id });
      const imprint = await savePublisher({ name: "Test Imprint", kind: "imprint", parentId: pub.id });
      // Wrong parents are refused
      await expect(savePublisher({ name: "Bad", kind: "imprint", parentId: group.id })).rejects.toThrow();
      await expect(savePublisher({ name: "Bad", kind: "publisher", parentId: pub.id })).rejects.toThrow();
      await expect(savePublisher({ name: "Bad", kind: "group", parentId: group.id })).rejects.toThrow();
      const w = await work("Rolled up");
      const e = await edition(w.id, "Test Imprint");
      expect((await getEditionPublisherLinks(e.id))[0].publisher.id).toBe(imprint.id);
      for (const id of [group.id, pub.id, imprint.id])
        expect((await getPublisherCatalogue(id)).totals.works, id).toBe(1);
      expect((await getPublisherCatalogue(other.id)).totals.works).toBe(0);
      expect((await getWorks({ filters: { publisherIds: [group.id] } })).map((x) => x.id)).toEqual([w.id]);
      expect((await getPublishers({ search: "Test Group" })).rows[0].editionCount).toBe(1);
      // A target "from the group" accepts the imprint's edition
      const target = await createAcquisitionTarget({ workId: w.id, publisherId: group.id });
      const [{ ok }] = await client!`select target_accepts_edition(${target.id}, ${e.id}) as ok`;
      expect(ok).toBe(true);
      // Ownership changes: an imprint with books moves, and the move is logged
      await savePublisher({ name: "Test Imprint", kind: "imprint", parentId: other.id }, imprint.id);
      expect((await getPublisherCatalogue(other.id)).totals.works).toBe(1);
      const moves = await db.select().from(schema.publisherHierarchyChanges);
      expect(moves).toMatchObject([{ publisherId: imprint.id, oldParentId: pub.id, newParentId: other.id }]);
      // A type that no longer fits the houses below is refused
      await expect(
        savePublisher({ name: "Other Publisher", kind: "imprint", parentId: pub.id }, other.id),
      ).rejects.toThrow();
    });
    it("links only the most specific house, and lets the ISBN decide between same-name houses", async () => {
      const group = await savePublisher({ name: "Penguin Random House", kind: "group" });
      const penguin = await savePublisher({ name: "Penguin Books", kind: "publisher", parentId: group.id, aliases: ["Penguin"] });
      const classics = await savePublisher({ name: "Penguin Classics", kind: "imprint", parentId: penguin.id });
      const uk = await savePublisher({ name: "Vintage Publishing", kind: "publisher", parentId: group.id, isbnPrefixes: ["978-0-09"] });
      const kd = await savePublisher({ name: "Knopf Doubleday Publishing Group", kind: "publisher", parentId: group.id, isbnPrefixes: ["978-0-679"] });
      const vintageUk = await savePublisher({ name: "Vintage", kind: "imprint", parentId: uk.id, aliases: ["Vintage Books"] });
      const vintageUs = await savePublisher({ name: "Vintage Books", kind: "imprint", parentId: kd.id, aliases: ["Vintage"] });
      const w = await work();
      const both = await createEdition({ workId: w.id, title: "A book", publisher: "Penguin", imprint: "Penguin Classics" });
      expect((await getEditionPublisherLinks(both.id)).map((l) => l.publisher.id)).toEqual([classics.id]);
      const ukBook = await raw(w.id, "Vintage", isbn("978009928583"));
      const usBook = await raw(w.id, "Vintage Books", isbn("978067972294"));
      const noIsbn = await raw(w.id, "Vintage");
      expect((await getEditionPublisherLinks(ukBook.id))[0].publisher.id).toBe(vintageUk.id);
      expect((await getEditionPublisherLinks(usBook.id))[0].publisher.id).toBe(vintageUs.id);
      expect(await getEditionPublisherLinks(noIsbn.id)).toEqual([]);
      const linkOf = async (id: string) => (await getEditionPublisherLinks(id)).map((l) => l.publisher.name);
      // A prefix the whole group shares: the book's other name decides between the Vintages
      await savePublisher({ name: "Penguin Random House", kind: "group", isbnPrefixes: ["978-0-593"] }, group.id);
      const shared = await db.insert(schema.editions).values({
        workId: w.id, title: "A book", publisher: "Knopf Doubleday Publishing Group", imprint: "Vintage Books", isbn13: isbn("978059300000"),
      }).returning();
      expect(await linkOf(shared[0].id)).toEqual(["Vintage Books"]);
      // The printed imprint beats a sibling the publisher text gives
      await savePublisher({ name: "Vintage International", kind: "imprint", parentId: kd.id });
      const refined = await db.insert(schema.editions).values({
        workId: w.id, title: "A book", publisher: "Vintage Books", imprint: "Vintage International", isbn13: isbn("978067972020"),
      }).returning();
      expect(await linkOf(refined[0].id)).toEqual(["Vintage International"]);
      // A group's name gives way to the ISBN's publisher inside the group
      const groupOnly = await raw(w.id, "Penguin Random House", isbn("978009928584"));
      expect(await linkOf(groupOnly.id)).toEqual(["Vintage Publishing"]);
    });
    it("applies the taxonomy in one transaction: a dry run leaves nothing, undo restores the edition fields", async () => {
      await savePublisher({ name: "Old Group", aliases: ["Old Group Plc"] });
      const spec: HouseSpec[] = [
        {
          name: "New Group",
          kind: "group",
          existing: ["Old Group"],
          children: [
            {
              name: "Test Books",
              kind: "publisher",
              aliases: ["Test Books Ltd"],
              prefixes: ["978-1-84668"],
              evidence: [/^test books$/i],
              children: [
                { name: "Test Classics", kind: "imprint", evidence: [/^test classics$/i] },
                { name: "Test Modern", kind: "imprint", evidence: [/^test modern$/i] },
                { name: "Unused Imprint", kind: "imprint", evidence: [/^unused$/i], onlyIfUsed: true },
              ],
            },
          ],
        },
      ];
      const w = await work();
      const code = isbn("978184668000");
      const other = isbn("978184668001");
      const e = await raw(w.id, "Test Books Ltd", code);
      const printed = await raw(w.id, "Test Classics", other);
      const input = {
        spec,
        editions: [
          { id: e.id, title: "A book", publisher: "Test Books Ltd", imprint: null, isbn13: code, isbn10: null, country: null, confirmed: false },
          { id: printed.id, title: "Printed", publisher: "Test Classics", imprint: null, isbn13: other, isbn10: null, country: "France", confirmed: false },
        ],
        sources: new Map([
          [code, { publishers: ["Test Books"], series: ["Test Classics"], places: ["London"] }],
          // The book says one imprint, the source another: nothing changes
          [other, { publishers: ["Test Modern"], series: [], places: ["London"] }],
        ]),
      };
      const housesBefore = await db.select().from(schema.publishingHouses);
      class Rollback extends Error {}
      let dry: Awaited<ReturnType<typeof applyTaxonomy>> | null = null;
      await expect(
        client!.begin(async (tx) => {
          dry = await applyTaxonomy(tx, input);
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
      expect(dry!.houses.map((h) => [h.path.at(-1), h.action])).toEqual([
        ["New Group", "update"],
        ["Test Books", "create"],
        ["Test Classics", "create"],
        ["Test Modern", "create"],
      ]);
      expect(dry!.links).toEqual([
        { editionId: e.id, title: "A book", before: [], after: ["Test Classics"] },
        { editionId: printed.id, title: "Printed", before: [], after: ["Test Classics"] },
      ]);
      expect(dry!.disagreements).toEqual([{ title: "Printed", printed: "Test Classics", source: "Test Modern" }]);
      // An existing country is never overwritten
      expect(dry!.enrichments.filter((x) => x.editionId === printed.id)).toEqual([]);
      expect(await db.select().from(schema.publishingHouses)).toEqual(housesBefore);
      expect((await db.select().from(schema.editions))[0].imprint).toBeNull();

      const applied = await client!.begin((tx) => applyTaxonomy(tx, input));
      const [saved] = await db.select().from(schema.editions).where(eq(schema.editions.id, e.id));
      expect(saved).toMatchObject({ imprint: "Test Classics", publicationCountry: "United Kingdom" });
      expect((await getEditionPublisherLinks(e.id)).map((l) => l.publisher.name)).toEqual(["Test Classics"]);
      const group = (await db.select().from(schema.publishingHouses)).find((h) => h.name === "New Group")!;
      expect(group.kind).toBe("group");
      expect((await db.select().from(schema.publisherAliases)).map((a) => a.name).sort()).toEqual([
        "Old Group",
        "Old Group Plc",
        "Test Books Ltd",
      ]);
      expect((await db.select().from(schema.publishingHouses)).map((h) => h.name)).not.toContain("Unused Imprint");

      expect(await client!.begin((tx) => undoTaxonomyRun(tx, applied.runId))).toBe(2);
      const [restored] = await db.select().from(schema.editions).where(eq(schema.editions.id, e.id));
      expect(restored).toMatchObject({ imprint: null, publicationCountry: null });
      expect((await getEditionPublisherLinks(e.id)).map((l) => l.publisher.name)).toEqual(["Test Books"]);
    });
    it("does not conflate same-name publishers, including names that become ambiguous later", async () => {
      const us = await publisher("Wakefield Press");
      const w = await work();
      const e = await edition(w.id, "Wakefield Press");
      expect((await getEditionPublisherLinks(e.id))[0].publisher.id).toBe(
        us.id,
      );
      await publisher("Wakefield Press", "Australia");
      expect(await getEditionPublisherLinks(e.id)).toEqual([]);
      expect((await getPublisherNameInbox()).total).toBe(1);
      await setEditionPublisherLinks(e.id, [us.id]);
      expect((await getPublisherNameInbox()).total).toBe(0);
    });
    it("preserves explicit multi-publisher choices and explicit empty choices during metadata refresh", async () => {
      const a = await publisher("House A"),
        b = await publisher("House B");
      const w = await work();
      const e = await edition(w.id, "House A");
      await setEditionPublisherLinks(e.id, [a.id, b.id, a.id]);
      await updateEdition(e.id, { publisher: "Unknown imported spelling" });
      expect(
        (await getEditionPublisherLinks(e.id))
          .map((x) => x.publisher.id)
          .sort(),
      ).toEqual([a.id, b.id].sort());
      await setEditionPublisherLinks(e.id, []);
      await updateEdition(e.id, { publisher: "House A" });
      expect(await getEditionPublisherLinks(e.id)).toEqual([]);
      await resetEditionPublisherLinks(e.id);
      expect((await getEditionPublisherLinks(e.id))[0].publisher.id).toBe(a.id);
    });
    it("rolls back edition and publisher writes together when any foreign key is invalid", async () => {
      const w = await work();
      const bad = "00000000-0000-4000-8000-000000000001";
      await expect(
        createEdition({ workId: w.id, title: "Invalid", publisherIds: [bad] }),
      ).rejects.toThrow();
      expect(await db.select().from(schema.editions)).toHaveLength(0);
      const p = await publisher(),
        e = await edition(w.id, p.name);
      await setEditionPublisherLinks(e.id, [p.id]);
      await expect(
        updateEdition(e.id, { title: "Changed", publisherIds: [bad] }),
      ).rejects.toThrow();
      expect((await db.select().from(schema.editions))[0].title).toBe(
        "Edition",
      );
      expect((await getEditionPublisherLinks(e.id))[0].publisher.id).toBe(p.id);
      await expect(
        savePublisher(
          { name: "Changed", aliases: ["New Alias"], specialtyIds: [bad] },
          p.id,
        ),
      ).rejects.toThrow();
      expect((await db.select().from(schema.publishingHouses))[0].name).toBe(
        "NYRB",
      );
      expect(await db.select().from(schema.publisherAliases)).toHaveLength(0);
    });
    it("rolls imprints up to their house without conflating siblings or double-counting co-publications", async () => {
      const p = await publisher(),
        i = await savePublisher({
          name: "Classics",
          kind: "imprint",
          parentId: p.id,
        });
      const sibling = await savePublisher({
        name: "Kids",
        kind: "imprint",
        parentId: p.id,
      });
      const w = await work(),
        e = await edition(w.id, i.name);
      await setEditionPublisherLinks(e.id, [p.id, i.id]);
      await own(e.id);
      expect((await getPublisherCatalogue(p.id)).totals).toEqual({
        works: 1,
        editions: 1,
      });
      expect((await getPublisherCatalogue(i.id, "owned")).rows).toHaveLength(1);
      expect((await getPublisherCatalogue(sibling.id)).rows).toHaveLength(0);
      await expect(
        savePublisher(
          { name: i.name, kind: "imprint", parentId: sibling.id },
          i.id,
        ),
      ).rejects.toThrow();
      await expect(
        db
          .delete(schema.publishingHouses)
          .where(eq(schema.publishingHouses.id, p.id)),
      ).rejects.toThrow();
    });
    it("owning Penguin leaves the NYRB edition wanted; exact-edition ownership and filters agree", async () => {
      const p = await publisher(),
        penguin = await publisher("Penguin"),
        w = await work();
      const e = await edition(w.id, p.name),
        other = await edition(w.id, penguin.name);
      await own(other.id);
      const t = await createAcquisitionTarget({
        workId: w.id,
        publisherId: p.id,
      });
      expect((await getPublisherCatalogue(p.id, "owned")).rows).toHaveLength(0);
      expect(
        (await getPublisherCatalogue(p.id, "wanted")).rows.map(
          (r) => r.edition.id,
        ),
      ).toEqual([e.id]);
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("wanted");
      expect((await getOrderAcquisitionOptions(w.id)).matches).toEqual([
        { targetId: t.id, editionId: e.id },
      ]);
      const filters = { publisherIds: [p.id] };
      expect((await getWorks({ filters })).map((w) => w.id)).toEqual([w.id]);
      expect(await getWorkCount(undefined, filters)).toBe(1);
      expect((await getWorksForTimeline({ filters })).map((w) => w.id)).toEqual(
        [w.id],
      );
    });
    it("rejects wrong editions on create, update, and delivery; received and returned statuses derive correctly", async () => {
      const p = await publisher(),
        other = await publisher("Penguin"),
        w = await work();
      const e = await edition(w.id, p.name),
        wrong = await edition(w.id, other.name);
      const t = await createAcquisitionTarget({
        workId: w.id,
        publisherId: p.id,
      });
      const input = {
        workId: w.id,
        acquisitionTargetId: t.id,
        orderDate: "2026-09-25",
        acquisitionMethod: "online_order" as const,
      };
      await expect(
        createOrder({ ...input, editionId: wrong.id }),
      ).rejects.toThrow();
      const o = await createOrder(input);
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("on_order");
      await expect(updateOrderStatus(o.id, "delivered")).rejects.toThrow();
      await expect(
        updateOrder(o.id, { editionId: wrong.id }),
      ).rejects.toThrow();
      await expect(cancelAcquisitionTarget(t.id)).rejects.toThrow();
      await updateOrder(o.id, { editionId: e.id });
      await updateOrderStatus(o.id, "delivered");
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("received");
      expect((await getPublisherCatalogue(p.id, "owned")).rows).toHaveLength(0); // receipt is not a copy record
      await updateOrderStatus(o.id, "returned");
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("wanted");
      await cancelAcquisitionTarget(t.id);
      expect(await getAcquisitionTargets(w.id)).toHaveLength(0);
    });
    it("validates target scope, uniqueness and edition/copy consistency at the database boundary", async () => {
      const p = await publisher(),
        w = await work(),
        w2 = await work("Other");
      const e = await edition(w.id, p.name),
        e2 = await edition(w2.id, p.name);
      await expect(
        createAcquisitionTarget({ workId: w.id, editionId: e2.id }),
      ).rejects.toThrow();
      await expect(
        createAcquisitionTarget({
          workId: w.id,
          editionId: e.id,
          publisherId: p.id,
        }),
      ).rejects.toThrow();
      const t = await createAcquisitionTarget({
        workId: w.id,
        editionId: e.id,
      });
      await expect(
        createAcquisitionTarget({ workId: w.id, editionId: e.id }),
      ).rejects.toThrow("already exists");
      const wrongCopy = await own(e2.id);
      await expect(
        createOrder({
          workId: w.id,
          editionId: e.id,
          instanceId: wrongCopy.id,
          acquisitionTargetId: t.id,
          acquisitionMethod: "gift",
          status: "received",
          orderDate: "2026-09-25",
        }),
      ).rejects.toThrow();
      await expect(
        db
          .update(schema.editions)
          .set({ workId: w2.id })
          .where(eq(schema.editions.id, e.id)),
      ).rejects.toThrow();
    });
    it("does not show disposed copies as owned and never fulfils targets from unrelated orders", async () => {
      const p = await publisher(),
        w = await work(),
        e = await edition(w.id, p.name),
        copy = await own(e.id);
      await db
        .update(schema.instances)
        .set({ status: "deaccessioned" })
        .where(eq(schema.instances.id, copy.id));
      await createAcquisitionTarget({ workId: w.id, editionId: e.id });
      await createOrder({
        workId: w.id,
        editionId: e.id,
        acquisitionMethod: "gift",
        status: "received",
        orderDate: "2026-09-25",
      });
      expect((await getPublisherCatalogue(p.id, "owned")).rows).toHaveLength(0);
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("wanted");
    });
    it("directory counts are scoped to each publisher, including zero-edition houses", async () => {
      const p = await publisher(),
        other = await publisher("Uncollected"),
        w = await work();
      await edition(w.id, p.name);
      const counts = (await getPublishers()).rows;
      expect(counts.find((r) => r.publisher.id === p.id)?.editionCount).toBe(1);
      expect(
        counts.find((r) => r.publisher.id === other.id)?.editionCount,
      ).toBe(0);
    });
    it("an owned book can be hunted from a publisher without inventing an edition", async () => {
      const p = await publisher(),
        penguin = await publisher("Penguin"),
        w = await work();
      await own((await edition(w.id, penguin.name)).id);
      await createAcquisitionTarget({ workId: w.id, publisherId: p.id });
      const filters = { publisherIds: [p.id], catalogueStatus: ["wanted"] };
      expect(await getWorkCount(undefined, filters)).toBe(1);
      expect((await getWorks({ filters })).map((w) => w.id)).toEqual([w.id]);
      expect((await getWorksForTimeline({ filters })).map((w) => w.id)).toEqual(
        [w.id],
      );
      expect((await getPublisherCatalogue(p.id)).pendingTargets).toHaveLength(
        1,
      );
      expect((await getPublisherCatalogue(p.id)).rows).toHaveLength(0);
      const o = await createOrder({
        workId: w.id,
        acquisitionTargetId: (await getAcquisitionTargets(w.id))[0].target.id,
        acquisitionMethod: "online_order",
        orderDate: "2026-09-25",
      });
      expect((await db.select().from(schema.works))[0].catalogueStatus).toBe(
        "accessioned",
      );
      expect(
        await getWorkCount(undefined, {
          publisherIds: [p.id],
          catalogueStatus: ["on_order"],
        }),
      ).toBe(1);
      await updateOrderStatus(o.id, "cancelled");
      expect((await db.select().from(schema.works))[0].catalogueStatus).toBe(
        "accessioned",
      );
    });
    it("any-edition targets and existing wanted books remain discoverable by publisher", async () => {
      const p = await publisher(),
        w = await work();
      const e = await edition(w.id, p.name);
      await db
        .update(schema.works)
        .set({ catalogueStatus: "wanted" })
        .where(eq(schema.works.id, w.id));
      expect(
        (await getPublisherCatalogue(p.id, "wanted")).rows.map(
          (r) => r.edition.id,
        ),
      ).toEqual([e.id]);
      await db
        .update(schema.works)
        .set({ catalogueStatus: "tracked" })
        .where(eq(schema.works.id, w.id));
      await createAcquisitionTarget({ workId: w.id });
      expect(
        (await getPublisherCatalogue(p.id, "wanted")).rows.map(
          (r) => r.edition.id,
        ),
      ).toEqual([e.id]);
    });
    it("fulfils an acquisition target only with an explicitly chosen matching copy; disposition reopens it", async () => {
      const p = await publisher(),
        other = await publisher("Penguin"),
        w = await work();
      const e = await edition(w.id, p.name),
        wrong = await edition(w.id, other.name),
        copy = await own(e.id),
        wrongCopy = await own(wrong.id);
      const t = await createAcquisitionTarget({
        workId: w.id,
        editionId: e.id,
      });
      await db
        .update(schema.works)
        .set({ catalogueStatus: "wanted" })
        .where(eq(schema.works.id, w.id));
      await expect(fulfilTargetWithCopy(t.id, wrongCopy.id)).rejects.toThrow();
      expect(
        (
          await db.select().from(schema.works).where(eq(schema.works.id, w.id))
        )[0].catalogueStatus,
      ).toBe("wanted");
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("wanted");
      await fulfilTargetWithCopy(t.id, copy.id);
      expect(
        (
          await db.select().from(schema.works).where(eq(schema.works.id, w.id))
        )[0].catalogueStatus,
      ).toBe("accessioned");
      expect(
        (
          await db
            .select()
            .from(schema.workStatusHistory)
            .where(eq(schema.workStatusHistory.workId, w.id))
        )[0],
      ).toMatchObject({ fromStatus: "wanted", toStatus: "accessioned" });
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("received");
      await expect(
        db
          .update(schema.instances)
          .set({ editionId: wrong.id })
          .where(eq(schema.instances.id, copy.id)),
      ).rejects.toThrow();
      await db
        .update(schema.instances)
        .set({ status: "deaccessioned" })
        .where(eq(schema.instances.id, copy.id));
      expect((await getAcquisitionTargets(w.id))[0].state).toBe("wanted");
    });
    /** A Google Books answer with these volume fields */
    function googleVolume(info: Record<string, unknown>) {
      return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        new Response(JSON.stringify({ volumeInfo: info }), { status: 200 }),
      );
    }
    const ids = (isbn13: string) => [{ type: "ISBN_13", identifier: isbn13 }];

    it("Match keeps manual publisher identities and honours metadata locks", async () => {
      const p = await publisher(),
        w = await work(),
        e = await edition(w.id, p.name);
      await setEditionPublisherLinks(e.id, [p.id]);
      const fetchMock = googleVolume({
        title: "Refreshed title",
        publisher: "Unrecognised spelling",
      });
      try {
        const preview = await previewMatch(e.id, "google_books", "synthetic-volume");
        expect(preview.houses.confirmed).toBe(true);
        // Same edition: values the reader has are not ticked
        expect(preview.rows.every((r) => !r.checked)).toBe(true);
        await applyMatch(e.id, "google_books", "synthetic-volume", [
          { field: "title", value: "Refreshed title" },
          { field: "publisher", value: "Unrecognised spelling" },
        ]);
        const [saved] = await db
          .select()
          .from(schema.editions)
          .where(eq(schema.editions.id, e.id));
        expect(saved).toMatchObject({
          title: "Refreshed title",
          publisher: "Unrecognised spelling",
          metadataSource: "google_books",
          googleBooksId: "synthetic-volume",
        });
        expect((await getEditionPublisherLinks(e.id))[0].publisher.id).toBe(p.id);
        await updateEdition(e.id, { metadataLocked: true });
        fetchMock.mockClear();
        expect((await previewMatch(e.id, "google_books", "synthetic-volume")).locked).toBe(true);
        await expect(
          applyMatch(e.id, "google_books", "synthetic-volume", [
            { field: "title", value: "Refreshed title" },
          ]),
        ).rejects.toThrow("Unlock");
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        fetchMock.mockRestore();
      }
    });

    it("Match previews the house and saves only ticked values the source still sends", async () => {
      const vintage = await savePublisher({ name: "Vintage International", country: "United States" });
      const penguin = await savePublisher({ name: "Penguin Books", country: "United Kingdom" });
      const w = await work("The Stranger");
      const old = isbn("978067972020");
      const e = await createEdition({
        workId: w.id,
        title: "The Stranger",
        publisher: "Vintage",
        imprint: "Vintage International",
        publicationCountry: "United States",
        isbn13: old,
      });
      expect((await getEditionPublisherLinks(e.id)).map((l) => l.publisher.id)).toEqual([vintage.id]);
      const next = isbn("978014118250");
      let fetchMock = googleVolume({
        title: "The Stranger",
        publisher: "Penguin Books",
        industryIdentifiers: ids(next),
        pageCount: 111,
        printType: "BOOK",
      });
      try {
        const preview = await previewMatch(e.id, "google_books", "vol-1");
        expect(preview.newEdition).toBe(true);
        const ticked = preview.rows.filter((r) => r.checked);
        expect(ticked.map((r) => r.field).sort()).toEqual(
          ["imprint", "isbn10", "isbn13", "pageCount", "publicationCountry", "publisher"].sort(),
        );
        // With the ticked values the edition leaves Vintage for Penguin
        expect(preview.houses.current.map((h) => h.id)).toEqual([vintage.id]);
        expect(preview.houses.next.map((h) => h.id)).toEqual([penguin.id]);
        // Unticking the imprint keeps Vintage International in the links
        const kept = await previewMatchHouses(e.id, {
          publisher: "Penguin Books",
          imprint: "Vintage International",
          isbn13: next,
          isbn10: null,
        });
        expect(kept.next.map((h) => h.id).sort()).toEqual([vintage.id, penguin.id].sort());
        // Nothing is written by a preview
        expect((await getEditionPublisherLinks(e.id)).map((l) => l.publisher.id)).toEqual([vintage.id]);

        // The source now answers another page count: the save stops
        fetchMock.mockRestore();
        fetchMock = googleVolume({
          title: "The Stranger",
          publisher: "Penguin Books",
          industryIdentifiers: ids(next),
          pageCount: 999,
        });
        const accepted = ticked.map((r) => ({ field: r.field, value: r.next }));
        await expect(applyMatch(e.id, "google_books", "vol-1", accepted)).rejects.toThrow(
          "changed since the preview",
        );
        fetchMock.mockRestore();
        fetchMock = googleVolume({
          title: "The Stranger",
          publisher: "Penguin Books",
          industryIdentifiers: ids(next),
          pageCount: 111,
        });
        await applyMatch(e.id, "google_books", "vol-1", accepted);
        const [saved] = await db
          .select()
          .from(schema.editions)
          .where(eq(schema.editions.id, e.id));
        expect(saved).toMatchObject({
          isbn13: next,
          publisher: "Penguin Books",
          imprint: null,
          publicationCountry: null,
          pageCount: 111,
          // Not ticked: the reader's title stays
          title: "The Stranger",
        });
        expect((await getEditionPublisherLinks(e.id)).map((l) => l.publisher.id)).toEqual([penguin.id]);
      } finally {
        fetchMock.mockRestore();
      }
    });

    it("Match blocks an ISBN another edition holds", async () => {
      const w = await work("The Stranger");
      const taken = isbn("978014118250");
      await createEdition({ workId: (await work("Another book")).id, title: "Another book", isbn13: taken });
      const e = await createEdition({ workId: w.id, title: "The Stranger", isbn13: isbn("978067972020") });
      const fetchMock = googleVolume({ title: "The Stranger", industryIdentifiers: ids(taken), pageCount: 90 });
      try {
        const preview = await previewMatch(e.id, "google_books", "vol-2");
        expect(preview.rows.find((r) => r.field === "isbn13")?.blocked).toMatch(/Another book/);
        expect(preview.rows.some((r) => r.checked)).toBe(false);
        await expect(
          applyMatch(e.id, "google_books", "vol-2", [{ field: "isbn13", value: taken }]),
        ).rejects.toThrow("Already on");
      } finally {
        fetchMock.mockRestore();
      }
    });

    it("binding takes its code and the database refuses free text", async () => {
      const w = await work();
      const e = await createEdition({ workId: w.id, title: "Bound", binding: "Mass Market Paperback" });
      expect(e.binding).toBe("paperback");
      await expect(updateEdition(e.id, { binding: "Kindle Edition" })).rejects.toThrow();
      await expect(
        db.update(schema.editions).set({ binding: "Paperback" }).where(eq(schema.editions.id, e.id)),
      ).rejects.toThrow();
    });

    it("concurrent duplicate acquisition requests create exactly one target", async () => {
      const p = await publisher(),
        w = await work();
      const outcomes = await Promise.allSettled([
        createAcquisitionTarget({ workId: w.id, publisherId: p.id }),
        createAcquisitionTarget({ workId: w.id, publisherId: p.id }),
      ]);
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await getAcquisitionTargets(w.id)).toHaveLength(1);
    });

    it("partial publisher edits preserve language, metadata lock and collector flags", async () => {
      const w = await work();
      const e = await createEdition({
        workId: w.id,
        title: "Preserved edition",
        publisher: "Unknown",
        language: "es",
        metadataLocked: true,
        isTranslated: true,
        isFirstEdition: true,
        isLimitedEdition: true,
      });
      await updateEdition(e.id, { publisher: "NYRB" });
      const [updated] = await db
        .select()
        .from(schema.editions)
        .where(eq(schema.editions.id, e.id));
      expect(updated).toMatchObject({
        language: "es",
        metadataLocked: true,
        isTranslated: true,
        isFirstEdition: true,
        isLimitedEdition: true,
        publisher: "NYRB",
      });
    });
    it("paginates publisher catalogues and review queues with shared page sizes and stable boundaries", async () => {
      const p = await publisher();
      const books = await db.insert(schema.works).values(Array.from({ length: 49 }, () => ({ title: "Same title" }))).returning();
      const editions = await db.insert(schema.editions).values(books.map((w) => ({ workId: w.id, title: "Edition", publisher: "Unresolved fixture house" }))).returning();
      await db.insert(schema.editionPublishers).values(editions.map((e) => ({ editionId: e.id, publisherId: p.id })));
      const first = await getPublisherCatalogue(p.id, "all", 1, 48);
      const second = await getPublisherCatalogue(p.id, "all", 2, 48);
      expect(first.totals.works).toBe(49);
      expect(first.rows).toHaveLength(48);
      expect(second.rows).toHaveLength(1);
      expect(new Set([...first.rows, ...second.rows].map((r) => r.work.id)).size).toBe(49);
      expect((await getPublisherCatalogue(p.id, "all", NaN, 24)).rows).toHaveLength(24);
      // The name inbox pages by name: 49 names without a house
      await db.insert(schema.editions).values(books.map((w, i) => ({ workId: w.id, title: "Other", publisher: `Unresolved house ${i}` })));
      const reviewFirst = await getPublisherNameInbox({ page: 1, perPage: 48 });
      const reviewSecond = await getPublisherNameInbox({ page: 2, perPage: 48 });
      expect(reviewFirst.total).toBe(49);
      expect(reviewFirst.rows).toHaveLength(48);
      expect(reviewSecond.rows).toHaveLength(1);
      expect(new Set([...reviewFirst.rows, ...reviewSecond.rows].map((r) => r.key)).size).toBe(49);
    });
  },
);

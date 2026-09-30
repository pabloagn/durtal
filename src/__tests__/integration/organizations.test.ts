import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_ORGANIZATION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln350_test"
  )
    throw new Error("Organization tests require disposable local sln350_test");
}
const client = url ? postgres(url, { max: 5, onnotice: () => {} }) : null;
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
vi.mock("@/lib/cache", () => ({
  invalidate: vi.fn(),
  cached: (fn: unknown) => fn,
  CACHE_TAGS: {},
}));
import {
  saveOrganization,
  getOrganization,
  getOrganizations,
  deleteOrganization,
  linkOrganizationVenue,
  unlinkOrganizationVenue,
  getOrganizationMergePreview,
  mergeOrganizations,
} from "@/lib/actions/organizations";
import {
  savePublisher,
  getPublishers,
  getPublisher,
  getPublisherOptions,
  getPublisherCountries,
  setPublisherFavourite,
  setEditionPublisherLinks,
  createAcquisitionTarget,
} from "@/lib/actions/publishers";
import { loadDataset } from "@/lib/harmonization/store";

describe.skipIf(!url)(
  "shared organizations and publisher compatibility",
  () => {
    const c = client!;
    let bookId: string, editionId: string;
    beforeAll(async () => {
      await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    }, 30000);
    afterAll(async () => {
      await client?.end();
    });
    beforeEach(async () => {
      await c`truncate works, publishing_houses, venues, harmonization_operations, harmonization_redirects cascade`;
      const [book] =
        await c`insert into works(title,slug) values ('Book','book') returning id`;
      bookId = book.id;
      const [edition] =
        await c`insert into editions(work_id,title) values (${bookId},'Edition') returning id`;
      editionId = edition.id;
    });
    it("preserves a publisher's identity, aliases and imprint hierarchy in the shared API", async () => {
      const parent = await savePublisher({
        name: "Existing publisher",
        aliases: ["Ancien éditeur"],
      });
      const imprint = await savePublisher({
        name: "Imprint",
        kind: "imprint",
        parentId: parent.id,
      });
      expect(await getOrganization(parent.id)).toMatchObject({
        id: parent.id,
        slug: parent.slug,
        roles: ["publisher"],
        aliases: [expect.objectContaining({ name: "Ancien éditeur" })],
      });
      expect(await getOrganization(imprint.id)).toMatchObject({
        parentId: parent.id,
        roles: ["imprint"],
      });
      await setEditionPublisherLinks(editionId, [imprint.id]);
      const target = await createAcquisitionTarget({
        workId: bookId,
        publisherId: parent.id,
      });
      await saveOrganization(
        {
          name: parent.name,
          roles: ["publisher", "retailer"],
          aliases: ["Ancien éditeur"],
        },
        parent.id,
      );
      expect((await getOrganization(parent.id))?.slug).toBe(parent.slug);
      expect(
        (
          await c`select publisher_id from acquisition_targets where id=${target.id}`
        )[0].publisher_id,
      ).toBe(parent.id);
      await savePublisher(
        { name: "Publisher edited", aliases: ["Alias edited"] },
        parent.id,
      );
      expect((await getOrganization(parent.id))?.roles).toEqual([
        "publisher",
        "retailer",
      ]);
    });
    it("keeps independent house, brand, manufacturer and retailer roles", async () => {
      const house = (await saveOrganization({
        name: "Maison",
        roles: ["perfume_house", "brand"],
      }))!;
      const maker = (await saveOrganization({
        name: "Factory",
        roles: ["manufacturer"],
      }))!;
      const shop = (await saveOrganization({
        name: "Online shop",
        roles: ["retailer"],
        website: "https://example.com",
      }))!;
      expect(house.kind).toBeNull();
      expect(house.roles.sort()).toEqual(["brand", "perfume_house"]);
      expect(maker.roles).toEqual(["manufacturer"]);
      expect(shop.venues).toEqual([]);
      expect(
        (await getOrganizations({ role: "retailer" })).rows.map((r) => r.id),
      ).toEqual([shop.id]);
    });
    it("excludes non-publishing identities from every legacy publisher discovery path", async () => {
      const org = (await saveOrganization({
        name: "Same name",
        roles: ["museum"],
        country: "Museum country",
        aliases: ["Shared alias"],
      }))!;
      expect((await getPublishers()).total).toBe(0);
      expect(await getPublisherOptions()).toEqual([]);
      expect(await getPublisherCountries()).toEqual([]);
      expect(await getPublisher(org.slug)).toBeNull();
      expect((await loadDataset()).publishing_houses).toEqual([]);
      await expect(setPublisherFavourite(org.id, true)).rejects.toThrow(
        "Publisher not found",
      );
      await expect(
        savePublisher({ name: "Accidental publisher" }, org.id),
      ).rejects.toThrow("Publisher not found");
      const publisher = await savePublisher({
        name: "Same name",
        aliases: ["Shared alias"],
      });
      const candidates =
        await c`select publisher_candidates('Shared alias') as id`;
      expect(candidates.map((r) => r.id)).toEqual([publisher.id]);
      await c`update editions set publisher='Same name' where id=${editionId}`;
      expect(
        (
          await c`select publisher_id from edition_publishers where edition_id=${editionId}`
        ).map((r) => r.publisher_id),
      ).toEqual([publisher.id]);
    });
    it("rejects non-publishers in book relationships through services and direct SQL", async () => {
      const org = (await saveOrganization({
        name: "Gallery",
        roles: ["gallery"],
      }))!;
      await expect(
        setEditionPublisherLinks(editionId, [org.id]),
      ).rejects.toThrow();
      expect(
        (
          await c`select publisher_links_confirmed from editions where id=${editionId}`
        )[0].publisher_links_confirmed,
      ).toBe(false);
      await expect(
        createAcquisitionTarget({ workId: bookId, publisherId: org.id }),
      ).rejects.toThrow();
      const [specialty] =
        await c`insert into publisher_specialties(name,slug) values ('Specialty','specialty') on conflict (slug) do update set name='Specialty' returning id`;
      await expect(
        c`insert into publishing_house_specialties values (${org.id},${specialty.id})`,
      ).rejects.toMatchObject({
        constraint_name: "publisher_profile_required",
      });
      await expect(
        c`update publishing_houses set parent_id=${org.id} where id=${org.id}`,
      ).rejects.toThrow();
    });
    it("guards in-use publisher profiles, including specialty-only identities", async () => {
      const pub = (await saveOrganization({
        name: "Publisher",
        roles: ["publisher"],
      }))!;
      const [specialty] =
        await c`insert into publisher_specialties(name,slug) values ('History','history') on conflict (slug) do update set name='History' returning id`;
      await c`insert into publishing_house_specialties values (${pub.id},${specialty.id})`;
      await expect(
        saveOrganization({ name: pub.name, roles: ["retailer"] }, pub.id),
      ).rejects.toThrow();
      expect((await getOrganization(pub.id))?.roles).toEqual(["publisher"]);
      await expect(
        saveOrganization({
          name: "Invalid imprint",
          roles: ["imprint"],
          parentId: randomUUID(),
        }),
      ).rejects.toThrow();
      await expect(
        saveOrganization({
          name: "Both",
          roles: ["publisher", "imprint"],
          parentId: pub.id,
        }),
      ).rejects.toThrow();
    });
    it("supports multiple venues and protects linked identities from deletion", async () => {
      const museum = (await saveOrganization({
        name: "Museum institution",
        roles: ["museum"],
      }))!;
      const venues =
        await c`insert into venues(name,type) values ('North branch','museum'),('South branch','museum') returning id`;
      for (const venue of venues)
        await linkOrganizationVenue({
          organizationId: museum.id,
          venueId: venue.id,
        });
      expect((await getOrganization(museum.id))?.venues).toHaveLength(2);
      await expect(deleteOrganization(museum.id)).rejects.toThrow();
      await expect(
        c`delete from venues where id=${venues[0].id}`,
      ).rejects.toThrow();
      for (const venue of venues)
        await unlinkOrganizationVenue({
          organizationId: museum.id,
          venueId: venue.id,
          role: "operator",
        });
      await deleteOrganization(museum.id);
      expect(await getOrganization(museum.id)).toBeUndefined();
      expect(await c`select id from venues`).toHaveLength(2);
    });
    it("searches aliases with consistent role-filtered counts and bounded stable paging", async () => {
      const a = (await saveOrganization({
        name: "Atelier",
        roles: ["perfume_house"],
        aliases: ["Fleur étrangère"],
      }))!;
      await saveOrganization({
        name: "Other",
        roles: ["retailer"],
        aliases: ["Fleur étrangère"],
      });
      expect(
        (
          await getOrganizations({
            query: "fleur etrangere",
            role: "perfume_house",
          })
        ).rows.map((r) => r.id),
      ).toEqual([a.id]);
      const first = await getOrganizations({ limit: 1 });
      const second = await getOrganizations({ limit: 1, offset: 1 });
      expect(first.total).toBe(2);
      expect(second.rows[0].id).not.toBe(first.rows[0].id);
      await expect(getOrganizations({ limit: 101 })).rejects.toThrow();
    });
    it("keeps concurrent same-name identities distinct and URLs stable after edits", async () => {
      const orgs = await Promise.all(
        Array.from({ length: 5 }, () =>
          saveOrganization({ name: "Same", roles: ["production_company"] }),
        ),
      );
      expect(new Set(orgs.map((o) => o!.slug)).size).toBe(5);
      const first = orgs[0]!;
      await saveOrganization(
        {
          name: "Renamed",
          roles: ["production_company", "distribution_company"],
        },
        first.id,
      );
      expect((await getOrganization(first.id))?.slug).toBe(first.slug);
    });
    it("merges roles, aliases and venue affiliations atomically with an audited redirect", async () => {
      const source = (await saveOrganization({
        name: "Source",
        roles: ["museum"],
        aliases: ["Old museum"],
      }))!;
      const target = (await saveOrganization({
        name: "Target",
        roles: ["gallery"],
      }))!;
      const [venue] =
        await c`insert into venues(name,type) values ('Branch','museum') returning id`;
      await linkOrganizationVenue({
        organizationId: source.id,
        venueId: venue.id,
      });
      const preview = await getOrganizationMergePreview(source.id, target.id);
      const choices = Object.fromEntries(
        preview.fields.filter((f) => f.conflict).map((f) => [f.key, "target"]),
      );
      await mergeOrganizations({
        sourceId: source.id,
        targetId: target.id,
        fingerprint: preview.fingerprint,
        choices,
      });
      const merged = (await getOrganization(target.id))!;
      expect(merged.roles.sort()).toEqual(["gallery", "museum"]);
      expect(merged.aliases.map((a) => a.name)).toEqual(
        expect.arrayContaining(["Source", "Old museum"]),
      );
      expect(merged.venues.map((v) => v.venueId)).toEqual([venue.id]);
      expect(await getOrganization(source.id)).toBeUndefined();
      expect(
        (
          await c`select target_id from harmonization_redirects where source_id=${source.id}`
        )[0].target_id,
      ).toBe(target.id);
      const publisher = await savePublisher({ name: "Publisher" });
      expect(
        (await getOrganizationMergePreview(target.id, publisher.id)).blockers
          .length,
      ).toBeGreaterThan(0);
    });
    it("rejects stale merge previews and rolls back invalid foreign-key edits", async () => {
      const a = (await saveOrganization({
        name: "A",
        roles: ["retailer"],
        aliases: ["Preserve"],
      }))!;
      const b = (await saveOrganization({ name: "B", roles: ["retailer"] }))!;
      const preview = await getOrganizationMergePreview(a.id, b.id);
      await saveOrganization(
        { name: "Changed", roles: ["retailer"], aliases: ["Preserve"] },
        a.id,
      );
      await expect(
        mergeOrganizations({
          sourceId: a.id,
          targetId: b.id,
          fingerprint: preview.fingerprint,
          choices: { name: "target" },
        }),
      ).rejects.toThrow();
      await expect(
        saveOrganization(
          {
            name: "Invalid",
            roles: ["manufacturer"],
            countryId: randomUUID(),
            aliases: [],
          },
          a.id,
        ),
      ).rejects.toThrow();
      expect(await getOrganization(a.id)).toMatchObject({
        name: "Changed",
        roles: ["retailer"],
        aliases: [expect.objectContaining({ name: "Preserve" })],
      });
    });
  },
);

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import { databaseErrorCode } from "@/lib/db/errors";
import { planLink, linkEbook, linkUndoEntry } from "@/lib/ebooks/match/link";
import { planUndoLink, undoLink } from "@/lib/ebooks/match/undo";
import type { Db } from "@/lib/catalogue/work-store";
import { ebookFileKey } from "@/lib/ebooks/keys";
import { bookHoldings } from "@/lib/catalogue/holdings";

const url = process.env.DURTAL_EBOOK_MATCH_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln495_ebook_match"
  )
    throw new Error(
      "Ebook matching tests require disposable local sln495_ebook_match",
    );
}
const client = url ? postgres(url, { max: 5, onnotice: () => {} }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("Matcher must use its explicitly supplied connection");
      },
    },
  ),
}));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe.skipIf(!url)("ebook matching on disposable PostgreSQL", () => {
  const c = client!;
  const database = (client ? drizzle(client, { schema }) : null) as unknown as Db;
  let workId: string,
    otherWorkId: string,
    editionId: string,
    otherEditionId: string,
    instanceId: string,
    ebookId: string;
  beforeAll(async () => {
    await migrate(drizzle(c, { schema }), {
      migrationsFolder: "src/lib/db/migrations",
    });
    const [row] =
      await c`select to_regclass('public.ebook_match_candidates')::text as present`;
    if (!row.present)
      throw new Error(
        "Root-approved generated 0082 required before this database suite; manual proposals are never applied by tests",
      );
  }, 60_000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`delete from ebook_files`;
    await c`delete from ebooks`;
    await c`delete from instances`;
    await c`delete from editions`;
    await c`delete from works where kind='book'`;
    workId = randomUUID();
    otherWorkId = randomUUID();
    editionId = randomUUID();
    otherEditionId = randomUUID();
    instanceId = randomUUID();
    ebookId = randomUUID();
    const locationId = randomUUID();
    await c`insert into locations(id,name,type) values(${locationId},'Matcher test','digital')`;
    await c`insert into works(id,title,kind,original_language) values(${workId},'Nadja','book','en'),(${otherWorkId},'Other','book','en')`;
    await c`insert into editions(id,work_id,title,language) values(${editionId},${workId},'Nadja','en'),(${otherEditionId},${otherWorkId},'Other','en')`;
    await c`insert into instances(id,edition_id,location_id) values(${instanceId},${editionId},${locationId})`;
    await c`insert into ebooks(id,title,import_source,match_tier) values(${ebookId},'Nadja','folder','strong')`;
    const sha256 = "a".repeat(64);
    await c`insert into ebook_files(id,ebook_id,sha256,format,size_bytes,content_type,s3_key,status) values(${randomUUID()},${ebookId},${sha256},'epub',1000,'application/epub+zip',${ebookFileKey(sha256, "epub")},'stored')`;
  });
  const insertCandidate = (
    conn: postgres.Sql | postgres.TransactionSql,
    selectedWork = workId,
    selectedEdition: string | null = editionId,
    selectedInstance: string | null = instanceId,
  ) =>
    (conn as postgres.Sql)`insert into ebook_match_candidates(ebook_id,rank,work_id,edition_id,instance_id,edition_rule,probability,weight_bits,margin_bits,reasons,model_version)
      values(${ebookId},1,${selectedWork},${selectedEdition},${selectedInstance},'fill_copy',0.99,10,5,'[]',1)`;
  const expectInvalidated = async () => {
    const [row] =
      await c`select match_tier,(select count(*)::int from ebook_match_candidates where ebook_id=${ebookId}) as candidates from ebooks where id=${ebookId}`;
    expect(row).toMatchObject({ match_tier: null, candidates: 0 });
  };
  const waitForLock = async (pid: number) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [row] =
        await c`select wait_event_type from pg_stat_activity where pid=${pid}`;
      if (row?.wait_event_type === "Lock") return;
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error(
      "Expected the concurrent candidate/parent statement to wait for a lock",
    );
  };
  it("commits a manual fill receipt and undoes only that link without recreating parents", async () => {
    const plan = await planLink(url!, {
      ebookId, workId, instanceId, method: "manual",
    });
    await linkEbook(database, plan, plan.targetDatabase);
    const [linked] = await c`select instance_id,match_state,link_written from ebooks where id=${ebookId}`;
    expect(linked).toMatchObject({ instance_id: instanceId, match_state: "linked" });
    expect(linked.link_written.after).toMatchObject({
      ebook: { id: ebookId, instance_id: instanceId },
      instance: { id: instanceId, edition_id: editionId },
      edition: { id: editionId, work_id: workId },
    });
    const undone = await planUndoLink(url!, linkUndoEntry(plan));
    if (undone.kind !== "planned") throw new Error("Expected own committed undo");
    await undoLink(database, undone.plan, plan.targetDatabase);
    const [pending] = await c`select instance_id,match_state,link_written from ebooks where id=${ebookId}`;
    expect(pending).toMatchObject({ instance_id: null, match_state: "pending", link_written: null });
    expect(await c`select id from instances where id=${instanceId}`).toHaveLength(1);
    expect(await c`select id from editions where id=${editionId}`).toHaveLength(1);
    expect(await planUndoLink(url!, linkUndoEntry(plan))).toMatchObject({ kind: "unchanged" });
  });
  it("rejects stale catalogue evidence inside the writer transaction", async () => {
    const plan = await planLink(url!, { ebookId, workId, instanceId, method: "manual" });
    await c`update works set title='Owner changed title' where id=${workId}`;
    await expect(linkEbook(database, plan, plan.targetDatabase)).rejects.toThrow();
    const [row] = await c`select instance_id,match_state,link_written from ebooks where id=${ebookId}`;
    expect(row).toMatchObject({ instance_id: null, match_state: "pending", link_written: null });
  });
  it("adds a digital holding without receiving a physical order or changing partial ownership lifecycle", async () => {
    const physicalLocation = randomUUID(), orderId = randomUUID();
    await c`insert into locations(id,name,type) values(${physicalLocation},'Physical shelf','physical')`;
    await c`insert into instances(id,edition_id,location_id,status) values(${randomUUID()},${editionId},${physicalLocation},'available')`;
    await c`update works set catalogue_status='on_order' where id=${workId}`;
    await c`insert into orders(id,work_id,edition_id,acquisition_method,status,order_date,destination_location_id) values(${orderId},${workId},${editionId},'online_order','placed','2026-10-09',${physicalLocation})`;
    const [before] = await c`select to_jsonb(o) as row from orders o where id=${orderId}`;
    const [destination] = await c`select location_id from instances where id=${instanceId}`;
    const plan = await planLink(url!, {
      ebookId, workId, editionId, method: "manual", locationId: String(destination.location_id),
    });
    await linkEbook(database, plan, plan.targetDatabase);
    const copies = await database.query.instances.findMany({
      where: (row, { eq }) => eq(row.editionId, editionId),
      with: { location: true },
    });
    expect(bookHoldings("on_order", copies.map((row) => ({
      ...row, location: { ...row.location,
        type: row.location.type === "digital" ? "digital" as const : "physical" as const },
    })))).toMatchObject({
      personallyOwned: true, totalActive: 3, physicalCount: 1, digitalCount: 2,
      lifecycle: { isPartiallyHeld: true, isInconsistent: false },
    });
    const [after] = await c`select to_jsonb(o) as row from orders o where id=${orderId}`;
    expect(after.row).toEqual(before.row);
    const [book] = await c`select catalogue_status from works where id=${workId}`;
    expect(book.catalogue_status).toBe("on_order");
    const undo = await planUndoLink(url!, linkUndoEntry(plan));
    if (undo.kind !== "planned") throw new Error("Expected undo");
    await undoLink(database, undo.plan, plan.targetDatabase);
    const [remaining] = await c`select count(*)::int as n from instances where edition_id=${editionId}`;
    expect(remaining.n).toBe(2);
    const [order] = await c`select to_jsonb(o) as row from orders o where id=${orderId}`;
    expect(order.row).toEqual(before.row);
  });
  it("prevents two separately planned operations from filling the same copy", async () => {
    const otherEbookId = randomUUID();
    await c`insert into ebooks(id,title,import_source) values(${otherEbookId},'Nadja','folder')`;
    const secondHash = "b".repeat(64);
    await c`insert into ebook_files(id,ebook_id,sha256,format,size_bytes,content_type,s3_key,status) values(${randomUUID()},${otherEbookId},${secondHash},'epub',1000,'application/epub+zip',${ebookFileKey(secondHash, "epub")},'stored')`;
    const first = await planLink(url!, { ebookId, workId, instanceId, method: "manual" });
    const second = await planLink(url!, { ebookId: otherEbookId, workId, instanceId, method: "manual" });
    const results = await Promise.allSettled([
      linkEbook(database, first, first.targetDatabase),
      linkEbook(database, second, second.targetDatabase),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [count] = await c`select count(*)::int as n from ebooks where instance_id=${instanceId}`;
    expect(count.n).toBe(1);
  });
  it("preserves its newly created copy when a future FK table references it", async () => {
    const plan = await planLink(url!, { ebookId, workId, editionId, method: "manual", locationId: String((await c`select location_id from instances where id=${instanceId}`)[0].location_id) });
    await linkEbook(database, plan, plan.targetDatabase);
    await c`create table matching_future_dependency(id uuid primary key, instance_id uuid not null references instances(id) on delete cascade)`;
    try {
      await c`insert into matching_future_dependency(id,instance_id) values(${randomUUID()},${plan.instanceId})`;
      const undone = await planUndoLink(url!, linkUndoEntry(plan));
      if (undone.kind !== "planned") throw new Error("Expected undo plan");
      expect(undone.plan.cleanup.deleted.instances).toEqual([]);
      await undoLink(database, undone.plan, plan.targetDatabase);
      expect(await c`select id from instances where id=${plan.instanceId}`).toHaveLength(1);
      expect(await c`select id from matching_future_dependency`).toHaveLength(1);
    } finally {
      await c`drop table matching_future_dependency`;
    }
  });
  it("rejects a copy without its edition and cross-work/edition references", async () => {
    await expect(insertCandidate(c, workId, null)).rejects.toSatisfy(
      (error: unknown) => databaseErrorCode(error) === "23514",
    );
    await expect(insertCandidate(c, otherWorkId)).rejects.toSatisfy(
      (error: unknown) => databaseErrorCode(error) === "23514",
    );
    await expect(
      insertCandidate(c, otherWorkId, otherEditionId),
    ).rejects.toSatisfy(
      (error: unknown) => databaseErrorCode(error) === "23514",
    );
  });
  it.each(["edition", "copy"])(
    "invalidates candidates when their %s is reparented",
    async (parent) => {
      await insertCandidate(c);
      if (parent === "edition")
        await c`update editions set work_id=${otherWorkId} where id=${editionId}`;
      else
        await c`update instances set edition_id=${otherEditionId} where id=${instanceId}`;
      await expectInvalidated();
    },
  );
  it.each(["edition", "copy"])(
    "invalidates candidates before deleting their %s",
    async (parent) => {
      await insertCandidate(c);
      if (parent === "edition")
        await c`delete from editions where id=${editionId}`;
      else await c`delete from instances where id=${instanceId}`;
      await expectInvalidated();
    },
  );
  it.each(["edition", "copy"])(
    "serializes candidate insertion before concurrent %s reparenting",
    async (parent) => {
      const inserted = deferred(),
        release = deferred(),
        started = deferred();
      let pid = 0;
      const insertion = c.begin(async (tx) => {
        await insertCandidate(tx);
        inserted.resolve();
        await release.promise;
      });
      await inserted.promise;
      const reparent = c.begin(async (tx) => {
        const [backend] =
          await (tx as unknown as postgres.Sql)`select pg_backend_pid() as pid`;
        pid = backend.pid;
        started.resolve();
        if (parent === "edition")
          await (tx as unknown as postgres.Sql)`update editions set work_id=${otherWorkId} where id=${editionId}`;
        else
          await (tx as unknown as postgres.Sql)`update instances set edition_id=${otherEditionId} where id=${instanceId}`;
      });
      try {
        await started.promise;
        await waitForLock(pid);
      } finally {
        release.resolve();
      }
      await Promise.all([insertion, reparent]);
      await expectInvalidated();
    },
  );
  it.each(["edition", "copy"])(
    "rejects stale candidate insertion behind concurrent %s reparenting",
    async (parent) => {
      const changed = deferred(),
        release = deferred(),
        started = deferred();
      let pid = 0;
      const reparent = c.begin(async (tx) => {
        if (parent === "edition")
          await (tx as unknown as postgres.Sql)`update editions set work_id=${otherWorkId} where id=${editionId}`;
        else
          await (tx as unknown as postgres.Sql)`update instances set edition_id=${otherEditionId} where id=${instanceId}`;
        changed.resolve();
        await release.promise;
      });
      await changed.promise;
      const insertion = c
        .begin(async (tx) => {
          const [backend] =
            await (tx as unknown as postgres.Sql)`select pg_backend_pid() as pid`;
          pid = backend.pid;
          started.resolve();
          await insertCandidate(tx);
        })
        .then(
          () => null,
          (error: unknown) => error,
        );
      try {
        await started.promise;
        await waitForLock(pid);
      } finally {
        release.resolve();
      }
      await reparent;
      expect(databaseErrorCode(await insertion)).toBe("23514");
    },
  );
  it.each(["edition", "copy"])(
    "serializes candidate insertion before concurrent %s deletion",
    async (parent) => {
      const inserted = deferred(),
        release = deferred(),
        started = deferred();
      let pid = 0;
      const insertion = c.begin(async (tx) => {
        await insertCandidate(tx);
        inserted.resolve();
        await release.promise;
      });
      await inserted.promise;
      const deletion = c.begin(async (tx) => {
        const [backend] =
          await (tx as unknown as postgres.Sql)`select pg_backend_pid() as pid`;
        pid = backend.pid;
        started.resolve();
        if (parent === "edition")
          await (tx as unknown as postgres.Sql)`delete from editions where id=${editionId}`;
        else
          await (tx as unknown as postgres.Sql)`delete from instances where id=${instanceId}`;
      });
      try {
        await started.promise;
        await waitForLock(pid);
      } finally {
        release.resolve();
      }
      await Promise.all([insertion, deletion]);
      await expectInvalidated();
    },
  );
  it.each(["edition", "copy"])(
    "rejects stale candidate insertion behind concurrent %s deletion",
    async (parent) => {
      const deleted = deferred(),
        release = deferred(),
        started = deferred();
      let pid = 0;
      const deletion = c.begin(async (tx) => {
        if (parent === "edition")
          await (tx as unknown as postgres.Sql)`delete from editions where id=${editionId}`;
        else
          await (tx as unknown as postgres.Sql)`delete from instances where id=${instanceId}`;
        deleted.resolve();
        await release.promise;
      });
      await deleted.promise;
      const insertion = c
        .begin(async (tx) => {
          const [backend] =
            await (tx as unknown as postgres.Sql)`select pg_backend_pid() as pid`;
          pid = backend.pid;
          started.resolve();
          await insertCandidate(tx);
        })
        .then(
          () => null,
          (error: unknown) => error,
        );
      try {
        await started.promise;
        await waitForLock(pid);
      } finally {
        release.resolve();
      }
      await deletion;
      expect(databaseErrorCode(await insertion)).toBe("23514");
    },
  );
  it.each(["NaN", "Infinity", "-Infinity", "-0.1", "1.1"])(
    "rejects invalid stored probability %s",
    async (value) => {
      await expect(
        c`update ebooks set match_probability=${value}::real where id=${ebookId}`,
      ).rejects.toSatisfy(
        (error: unknown) => databaseErrorCode(error) === "23514",
      );
    },
  );
  it("clears duplicate review tier when its target disappears", async () => {
    const target = randomUUID();
    await c`insert into ebooks(id,title,import_source) values(${target},'Duplicate target','folder')`;
    await c`update ebooks set match_tier='duplicate',duplicate_of_id=${target} where id=${ebookId}`;
    await c`delete from ebooks where id=${target}`;
    const [row] =
      await c`select match_tier,duplicate_of_id from ebooks where id=${ebookId}`;
    expect(row).toMatchObject({ match_tier: null, duplicate_of_id: null });
  });
});

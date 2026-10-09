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
    await c`insert into editions(id,work_id,title) values(${editionId},${workId},'Nadja'),(${otherEditionId},${otherWorkId},'Other')`;
    await c`insert into instances(id,edition_id,location_id) values(${instanceId},${editionId},${locationId})`;
    await c`insert into ebooks(id,title,import_source,match_tier) values(${ebookId},'Nadja','folder','strong')`;
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

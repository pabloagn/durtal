import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const state = vi.hoisted(() => ({
  setting: "on",
  probeCode: "25006" as string | null,
  lost: false,
  lossWait: null as Promise<void> | null,
  pending: null as Promise<unknown> | null,
  events: [] as string[],
  queries: [] as string[],
  workId: "",
  factory: vi.fn(),
  end: vi.fn(),
}));
vi.mock("postgres", () => ({
  default: (...args: unknown[]) => state.factory(...args),
}));
// Any helper that omits its supplied connection must fail this test.
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("Unprotected global database access");
      },
    },
  ),
}));
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { works } from "@/lib/db/schema";
import { isbnClash } from "@/lib/catalogue/isbn-clash";
import {
  requireBookWork,
  requireBookWorks,
} from "@/lib/catalogue/book-boundary";
import type { Db } from "@/lib/catalogue/work-store";

beforeEach(() => {
  state.setting = "on";
  state.lost = false;
  state.lossWait = null;
  state.pending = null;
  state.probeCode = "25006";
  state.events = [];
  state.queries = [];
  state.workId = randomUUID();
  state.end = vi.fn(async () => {
    state.events.push("end");
  });
  state.factory = vi.fn((_url, options) => ({
    options: { parsers: {}, serializers: {} },
    end: state.end,
    begin: async (mode: string, work: (tx: unknown) => Promise<unknown>) => {
      expect(mode).toBe("read only");
      expect(options.connection).toBeUndefined(); // Pooler ignores startup defaults.
      state.events.push("begin read only");
      const tag = async (strings: TemplateStringsArray) => {
        const query = strings.join("?");
        state.queries.push(query);
        if (query.startsWith("show"))
          return [{ transaction_read_only: state.setting }];
        if (query.startsWith("update")) {
          if (state.probeCode)
            throw new Error("Probe refused", {
              cause: { code: state.probeCode },
            });
          return [];
        }
        throw new Error("Unexpected probe SQL");
      };
      const tx = Object.assign(tag, {
        savepoint: async (callback: (scope: unknown) => Promise<unknown>) => {
          state.events.push("savepoint");
          try {
            return await callback(tx);
          } catch (error) {
            state.events.push("rollback savepoint");
            throw error;
          }
        },
        unsafe: (query: string) => {
          state.queries.push(query);
          state.events.push("protected read");
          const rows = query.includes('"editions"')
            ? [["Existing edition", "9780306406157", null]]
            : [[state.workId]];
          return Object.assign(
            Promise.resolve([{ transaction_read_only: "on" }]),
            { values: () => Promise.resolve(rows) },
          );
        },
      });
      try {
        const pending = work(tx);
        state.pending = pending;
        if (state.lost) {
          void pending.catch(() => {});
          if (state.lossWait) await state.lossWait;
          throw new Error("Connection lost");
        }
        const result = await pending;
        state.events.push("commit");
        return result;
      } catch (error) {
        state.events.push("rollback");
        throw error;
      }
    },
  }));
});

describe("verified pooled planning context", () => {
  it("pins helper reads to the verified transaction without touching global db", async () => {
    const clash = await withReadOnlyPlanningConnection(
      "postgres://pool.invalid/library",
      async (database) => {
        expect(state.events).toContain("rollback savepoint");
        await requireBookWork(state.workId, database);
        await requireBookWorks([state.workId], database);
        expect(
          await database.query.works.findFirst({
            columns: { id: true },
            where: eq(works.id, state.workId),
          }),
        ).toEqual({ id: state.workId });
        return isbnClash({ isbn13: "9780306406157" }, undefined, database);
      },
    );
    expect(clash).toContain("Existing edition");
    expect(
      state.queries.filter((query) => query.startsWith("select")),
    ).toHaveLength(4);
    expect(state.events.at(-2)).toBe("commit");
    expect(state.events.at(-1)).toBe("end");
  });

  it.each(["off", "missing"])(
    "refuses setting %s before any helper executes",
    async (setting) => {
      state.setting = setting;
      const loader = vi.fn(async (database: Db) =>
        requireBookWork(state.workId, database),
      );
      await expect(
        withReadOnlyPlanningConnection(
          "postgres://pool.invalid/library",
          loader,
        ),
      ).rejects.toThrow("nothing ran");
      expect(loader).not.toHaveBeenCalled();
      expect(state.queries).toEqual(["show transaction_read_only"]);
      expect(state.end).toHaveBeenCalledOnce();
    },
  );

  it.each([null, "42501", "08006"])(
    "fails closed when the probe returns %s instead of 25006",
    async (code) => {
      state.probeCode = code;
      const loader = vi.fn(async () => "should not run");
      await expect(
        withReadOnlyPlanningConnection(
          "postgres://pool.invalid/library",
          loader,
        ),
      ).rejects.toThrow("nothing ran");
      expect(loader).not.toHaveBeenCalled();
      expect(state.events).toContain("rollback");
      expect(state.end).toHaveBeenCalledOnce();
    },
  );

  it("revokes retained queries and prepares before the protected connection is released", async () => {
    const retained = await withReadOnlyPlanningConnection(
      "postgres://pool.invalid/library",
      async (database) => ({
        database,
        query: database.execute(sql`select 1`),
      }),
    );
    const before = state.queries.length;
    await expect(retained.query).rejects.toThrow(
      "planning connection is closed",
    );
    await expect(retained.database.execute(sql`select 2`)).rejects.toThrow(
      "planning connection is closed",
    );
    expect(state.queries).toHaveLength(before);
  });

  it.each(["during probe", "during work"])(
    "revokes the handle when begin rejects %s before its callback settles",
    async (loss) => {
      state.lost = true;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      if (loss === "during work") state.lossWait = started;
      let release!: () => void;
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      await expect(
        withReadOnlyPlanningConnection(
          "postgres://pool.invalid/library",
          async (database) => {
            entered();
            await paused;
            return database.execute(sql`select 1`);
          },
        ),
      ).rejects.toThrow("Connection lost");
      release();
      await expect(state.pending!).rejects.toThrow(
        "planning connection is closed",
      );
      expect(
        state.queries.filter((query) => query.startsWith("select")),
      ).toHaveLength(0);
      expect(state.end).toHaveBeenCalledOnce();
    },
  );

  it("closes on callback failure and re-verifies the next connection before reads", async () => {
    await expect(
      withReadOnlyPlanningConnection(
        "postgres://pool.invalid/library",
        async () => {
          throw new Error("Loader failed");
        },
      ),
    ).rejects.toThrow("Loader failed");
    expect(state.end).toHaveBeenCalledOnce();
    state.setting = "off";
    const loader = vi.fn(async () => "unsafe");
    await expect(
      withReadOnlyPlanningConnection("postgres://pool.invalid/library", loader),
    ).rejects.toThrow("nothing ran");
    expect(loader).not.toHaveBeenCalled();
    expect(state.end).toHaveBeenCalledTimes(2);
  });
});

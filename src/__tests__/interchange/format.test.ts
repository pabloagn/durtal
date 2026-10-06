import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { utcTimestamp, rowProblems } from "@/lib/interchange/columns";
import { InterchangeFileError, readEnvelope, readRecord, readShared } from "@/lib/interchange/format";
import { RECORD_TABLES, TABLES, references, table } from "@/lib/interchange/tables";

describe("interchange format version 1", () => {
  it("pins every column it carries: a change to these tables needs a new version", () => {
    const columns = Object.fromEntries(
      [...TABLES.values()].map((t) => [
        t.shape.name,
        t.shape.columns.map((c) => `${c.name}:${c.kind}${c.nullable ? "?" : ""}${c.values ? `(${c.values.join("|")})` : ""}`),
      ]),
    );
    expect(columns).toMatchSnapshot();
  });

  it("writes every row after the rows it points at", () => {
    for (const t of TABLES.values())
      for (const ref of references(t)) {
        const target = TABLES.get(ref.table);
        expect(target, `${t.shape.name}.${ref.column} points outside the format`).toBeDefined();
        if (ref.table !== t.shape.name) expect(target!.order, `${t.shape.name} before ${ref.table}`).toBeLessThan(t.order);
      }
  });

  it("ties each record table to its work through record tables", () => {
    for (const t of RECORD_TABLES) {
      if (t.spec.mode !== "record") continue;
      let spec = t.spec;
      for (let hops = 0; spec.parent && spec.parent.table !== "works"; hops++) {
        expect(hops).toBeLessThan(5);
        const parent = table(spec.parent.table);
        expect(parent.spec.mode, `${t.shape.name}: ${parent.shape.name}`).toBe("record");
        expect(parent.shape.primaryKey).toHaveLength(1);
        spec = parent.spec as typeof spec;
      }
      if (!["works", "catalogue_dates"].includes(t.shape.name)) expect(spec.parent?.table).toBe("works");
    }
  });

  it("keeps a timestamp's microseconds and writes it in UTC", () => {
    expect(utcTimestamp("2026-10-05T21:56:14.123456+02:00")).toBe("2026-10-05T19:56:14.123456Z");
    expect(utcTimestamp("2026-10-05T19:56:14.120000+00:00")).toBe("2026-10-05T19:56:14.12Z");
    expect(utcTimestamp("2026-10-05 19:56:14+00")).toBe("2026-10-05T19:56:14Z");
    expect(utcTimestamp("yesterday")).toBeNull();
  });

  it("names unknown, missing and unfit columns", () => {
    const works = table("works").shape;
    expect(rowProblems(works, { id: "nope", extra: 1 })).toEqual(
      expect.arrayContaining(["extra: is not a column of works", "id: must be a UUID", "title: is missing"]),
    );
  });
});

describe("reading a file", () => {
  const envelope = { format: "durtal.interchange", version: 1, exportedAt: "2026-10-05T00:00:00Z", records: [], shared: {} };

  it("refuses another format or version as a whole", () => {
    expect(() => readEnvelope({ ...envelope, format: "goodreads" })).toThrow("This is not a Durtal interchange file");
    expect(() => readEnvelope({ ...envelope, version: 2 })).toThrow("This file is interchange version 2; this Durtal reads version 1");
    expect(() => readEnvelope({ ...envelope, version: "1" })).toThrow("The file does not say which interchange version it is");
    expect(() => readEnvelope(null)).toThrow(InterchangeFileError);
    expect(() => readShared({ wines: [] })).toThrow("The shared section has rows this Durtal cannot read");
    expect(() => readShared({ works: [] })).toThrow(InterchangeFileError);
  });

  const id = randomUUID();
  const workRow = (kind: string) => ({
    ...Object.fromEntries(table("works").shape.columns.map((c) => [c.name, null])),
    id,
    kind,
    title: "No 5",
    is_anthology: false,
    is_favourite: false,
    is_rare: false,
    is_poison: false,
    catalogue_status: "tracked",
    acquisition_priority: "none",
    created_at: "2026-10-05T00:00:00Z",
    updated_at: "2026-10-05T00:00:00Z",
  });
  const record = (domain: string, sections: Record<string, unknown>) => ({ domain, id, title: "No 5", sections });

  it("checks one record on its own and names each problem", () => {
    const fine = readRecord(record("perfume", { identity: { works: [workRow("perfume")] } }), 0);
    expect(fine.ok, fine.ok ? "" : fine.problems.join("\n")).toBe(true);

    const unknown = readRecord(record("wine", {}), 1);
    expect(unknown).toMatchObject({ ok: false, problems: [expect.stringContaining("“wine” is not a collection this Durtal knows")] });

    const wrongPlace = readRecord(
      record("perfume", { identity: { works: [workRow("perfume")] }, holdings: { film_holdings: [] }, history: { editions: [] }, moods: {} }),
      2,
    );
    expect(wrongPlace).toMatchObject({
      ok: false,
      problems: [
        "sections.holdings.film_holdings: a perfume record cannot carry it",
        "sections.history.editions: is not part of this section",
        "sections.moods: is not a section of version 1",
      ],
    });

    const otherKind = readRecord(record("perfume", { identity: { works: [workRow("film")] } }), 3);
    expect(otherKind).toMatchObject({ ok: false, problems: ["sections.identity.works[0].kind: must be perfume"] });
  });
});

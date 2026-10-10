/** Read-only declaration serialization, NOT drizzle-kit migration generation.
 * Run with pnpm exec tsx --tsconfig tsconfig.json; no database or env is read.
 */
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { SQL } from "drizzle-orm";
import { format } from "prettier";
import {
  ebookAnnotations,
  ebookAnnotationRetiredIds,
  ebookAnnotationCursors,
} from "../../src/lib/db/schema/ebook-annotations";
const dialect = new PgDialect();
const render = (value: SQL) => {
  const result = dialect.sqlToQuery(value);
  if (result.params.length)
    throw new Error("Unexpected bound schema parameter");
  return result.sql;
};
const tables = [
  ebookAnnotations,
  ebookAnnotationRetiredIds,
  ebookAnnotationCursors,
].map((table) => {
  const config = getTableConfig(table);
  return {
    table: config.name,
    columns: config.columns.map((column) => ({
      name: column.name,
      type: column.getSQLType(),
      notNull: column.notNull,
      primaryKey: column.primary,
      default:
        column.default instanceof SQL
          ? render(column.default)
          : (column.default ?? null),
    })),
    checks: config.checks.map((check) => ({
      name: check.name,
      sql: render(check.value),
    })),
    foreignKeys: config.foreignKeys.map((key) => {
      const ref = key.reference();
      return {
        name: key.getName(),
        columns: ref.columns.map((c) => c.name),
        target: getTableConfig(ref.foreignTable).name,
        targetColumns: ref.foreignColumns.map((c) => c.name),
        onDelete: key.onDelete,
      };
    }),
    indexes: config.indexes.map((index) => ({
      name: index.config.name,
      method: index.config.method,
      columns: index.config.columns.map((column) =>
        column instanceof SQL
          ? render(column)
          : "name" in column
            ? column.name
            : (() => {
                throw new Error("Unsupported index declaration");
              })(),
      ),
      where: index.config.where ? render(index.config.where) : null,
    })),
  };
});
process.stdout.write(
  await format(
    JSON.stringify({
      kind: "runtime-declaration-review-snapshot",
      migrationGenerated: false,
      tables,
    }),
    { parser: "json" },
  ),
);

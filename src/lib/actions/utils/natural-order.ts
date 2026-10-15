import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * A name's sort key with its numbers in numeric order: "Galerie 2" before
 * "Galerie 10", as titles sort (`compareTitles`). Every run of digits is
 * padded to 20 places, so the database's own collation still decides case
 * and accents. Order by the key, then by the name itself, so "Volume 007"
 * and "Volume 7" keep one order across pages.
 */
export function naturalOrder(name: SQLWrapper): SQL {
  return sql`regexp_replace(regexp_replace(${name}, '[0-9]+', '00000000000000000000\\&', 'g'), '0*([0-9]{20})(?![0-9])', '\\1', 'g')`;
}

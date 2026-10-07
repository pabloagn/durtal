import { sql, type SQL } from "drizzle-orm";

/*
 * The gold set (SLN-460, SLN-471), kept blind: Pablo labels these books
 * without seeing the pipeline's proposals, so reports and the inbox hide their
 * values (counts only, never a term, value or excerpt) until he has labelled
 * them. SLN-471 switches the condition to its labels.
 *
 * The 20 books Pablo named on 4 Oct, by work id, checked read-only against
 * live-before-0078-20261007-033858.dump on 7 Oct (20 of 20). The other 30 of
 * SLN-461's approved list join once Pablo approves vocabulary v1.
 */
export const GOLD_SET_WORK_IDS: readonly string[] = [
  "ccf73028-f55d-47b9-a6bc-f5b558b7ca79", // Kaputt
  "6eae27a8-cea0-46fc-827b-e57fd0c85936", // The Skin
  "51aa763a-e8e3-4870-9751-227fb80b9a72", // The Brothers Karamazov
  "7572e2e8-212d-456a-ad23-51fe00afa404", // Life and Fate
  "2c2cf611-dee7-405e-b00b-1c0f85f9d6f3", // The Notebook
  "edb3956b-b39c-4dd1-b0b2-74606466ded2", // I Who Have Never Known Men
  "b429c4de-a5ce-4c52-8885-997fa9504555", // Hunger
  "5a219800-4b20-45bc-aaf3-5d09c33b9e0c", // Beware of Pity
  "f6d53296-5ec2-4858-99f5-3d80d835300c", // Our Share of Night
  "9bd5ee83-d1b0-42be-93a3-8fa0f2b2eca1", // Solenoid
  "4b2d84a1-5316-414e-85c8-028579e17376", // The Obscene Bird of Night
  "cfa282ec-db92-4888-b15c-c92ff7fed7f1", // The Vorrh
  "5db17f3e-a19a-43d0-8008-c5325315d3d3", // Lanark
  "624784a5-ead8-4726-9ec6-55ee582c0548", // Tender Is the Flesh
  "77283497-4a42-4958-94bd-b433bde1aae3", // 2666
  "5758cecb-4539-4238-9448-01432f3d87ca", // Satantango
  "295f01ae-c851-4cb8-b742-51c3940401ce", // Blood Meridian
  "c68cb819-a93c-4f30-8e75-80b4d4ad3a9d", // House of Leaves
  "16ea1729-4595-479a-809e-463d9dc5d3d0", // Maldoror
  "f8812d44-3c57-4fbe-9f2a-13ca1e5fd70e", // Blindness
];

/** True where a book's values stay hidden: a gold-set book, on every research dimension, until SLN-471 has Pablo's labels */
export function goldSetHiddenCondition(workId: SQL): SQL<boolean> {
  return sql<boolean>`(${workId} in (${sql.join(GOLD_SET_WORK_IDS.map((id) => sql`${id}::uuid`), sql`, `)}))`;
}

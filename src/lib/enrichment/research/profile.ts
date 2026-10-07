import { sql, type SQL } from "drizzle-orm";
import { resultRows } from "@/lib/harmonization/store";
import type { Db } from "@/lib/catalogue/work-store";
import { currentVocabularyVersion } from "../claims";

/*
 * What the research agent may know about a book (SLN-469, section 1): its
 * titles, authors, translators and original language, from the catalogue
 * only. Never its notes, rating, description, marks, locations, readings or
 * any proposal: Pablo's own data never reaches a search provider or a model (R7).
 */

export interface ResearchAuthor {
  name: string;
  /** `last_name`, else the last word of the name */
  surname: string;
}

export interface ResearchProfile {
  workId: string;
  slug: string;
  /** The work's title first, then the original title, then edition titles in the original language or English */
  titles: string[];
  /** `works.original_title`, when set */
  originalTitle: string | null;
  authors: ResearchAuthor[];
  /** Translators of owned editions first */
  translators: ResearchAuthor[];
  originalLanguage: string | null;
}

const rows = async <T>(conn: Db, query: SQL) => resultRows<T>(await conn.execute(query));
const surnameOf = (a: { name: string; lastName: string | null }) => a.lastName?.trim() || a.name.trim().split(/\s+/).pop()!;

/** The profiles of some books; a book without an author is left out with its reason */
export async function loadProfiles(conn: Db, workIds: string[]) {
  if (!workIds.length) return { profiles: [] as ResearchProfile[], skipped: [] as { workId: string; reason: string }[] };
  const ids = sql.join(workIds.map((id) => sql`${id}::uuid`), sql`, `);
  const found = await rows<{
    workId: string;
    slug: string;
    title: string;
    originalTitle: string | null;
    originalLanguage: string | null;
    editionTitles: string[];
    authors: { name: string; lastName: string | null }[];
    translators: { name: string; lastName: string | null }[];
  }>(
    conn,
    sql`select w.id as "workId", w.slug, w.title, w.original_title as "originalTitle", w.original_language as "originalLanguage",
        coalesce((select array_agg(distinct e.title) from editions e
          where e.work_id = w.id and (e.language = coalesce(w.original_language, 'en') or e.language = 'en')), '{}') as "editionTitles",
        coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'lastName', a.last_name) order by wa.sort_order, a.name)
          from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id), '[]'::jsonb) as authors,
        -- Translators of owned editions first
        coalesce((select jsonb_agg(t.person order by t.owned desc, t.name) from (
            select distinct on (a.id) jsonb_build_object('name', a.name, 'lastName', a.last_name) as person, a.name,
              exists (select 1 from instances i where i.edition_id = e.id and i.status <> 'deaccessioned') as owned
            from editions e join edition_contributors ec on ec.edition_id = e.id and ec.role = 'translator' join authors a on a.id = ec.author_id
            where e.work_id = w.id order by a.id, owned desc) t), '[]'::jsonb) as translators
      from works w where w.kind = 'book' and w.id in (${ids}) order by w.id`,
  );
  const profiles: ResearchProfile[] = [];
  const skipped: { workId: string; reason: string }[] = [];
  for (const w of found) {
    if (!w.authors.length) {
      skipped.push({ workId: w.workId, reason: "the book has no author" });
      continue;
    }
    const titles = [w.title, w.originalTitle, ...w.editionTitles.sort()].map((t) => t?.trim()).filter((t): t is string => !!t);
    profiles.push({
      workId: w.workId,
      slug: w.slug,
      titles: [...new Set(titles)],
      originalTitle: w.originalTitle?.trim() || null,
      authors: w.authors.map((a) => ({ name: a.name, surname: surnameOf(a) })),
      translators: w.translators.map((a) => ({ name: a.name, surname: surnameOf(a) })),
      originalLanguage: w.originalLanguage?.trim().toLowerCase() || null,
    });
  }
  return { profiles, skipped };
}

/** A research dimension of the current vocabulary, with its current terms (for the topic-word check) */
export interface ResearchDimension {
  key: string;
  label: string;
  layer: "experience" | "facts";
  terms: { key: string; label: string }[];
}

/**
 * The research dimensions (SLN-469, section 1): every experience dimension of
 * kind term, terms or scale, and a facts dimension of kind term or terms
 * that its seed marks `research: true`. Never identity, length or popularity.
 */
export async function researchDimensions(conn: Db): Promise<ResearchDimension[]> {
  const version = await currentVocabularyVersion(conn);
  if (!version) return [];
  return rows<ResearchDimension>(
    conn,
    sql`select d.key, d.label, d.layer,
        coalesce((select jsonb_agg(jsonb_build_object('key', t.key, 'label', t.label) order by t.key) from enrichment_terms t
          where t.dimension_id = d.id and t.introduced_in <= ${version} and (t.retired_in is null or t.retired_in > ${version})), '[]'::jsonb) as terms
      from enrichment_dimensions d
      where d.introduced_in <= ${version} and (d.retired_in is null or d.retired_in > ${version})
        and ((d.layer = 'experience' and d.value_kind in ('term', 'terms', 'scale'))
          or (d.layer = 'facts' and d.value_kind in ('term', 'terms') and (d.parameters ->> 'research') = 'true'))
      order by d.layer desc, d.key`,
  );
}

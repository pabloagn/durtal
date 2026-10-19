-- A well-used book for the heavy-book page-weight check (SLN-1163), on a
-- disposable preview database only (scripts/qa/preview-local.py
-- --seed-heavy-book; the check is page-weight-heavy.json). After the book
-- page survey (findings/book-page-survey-2026-10-18): The Survey Heavy Book,
-- /library/survey-heavy-book, rare and poison, volume 3 of a 30-volume
-- series, with 12 editions, 16 copies, 4 readings, 40 quotes and notes,
-- 10 collections, 5 recommenders and 6 subjects. Its 29 sibling volumes share
-- its author and two of its subjects, and are rare or poison in turn, so
-- every shelf on its page is full. Its ten translators each translated a
-- sibling volume too, and its editions come from three publishers, two of
-- which published siblings, so it has thirteen creator and publishing
-- shelves to offer, of which the page shows three. Ids are valid UUIDs: the
-- book page refuses others.

\set ON_ERROR_STOP on
-- Never on any database but the disposable preview's
do $$ begin
  if current_database() <> 'durtal_preview' then
    raise exception 'seed-heavy-book.sql runs on the disposable preview database only (durtal_preview), not %', current_database();
  end if;
end $$;

create function pg_temp.vu(t text) returns uuid language sql immutable as $$
  select (left(md5(t), 12) || '4' || substr(md5(t), 14, 3) || 'a' || substr(md5(t), 18))::uuid
$$;

begin;
insert into authors (id, name, slug, sort_name, first_name, last_name, birth_year, death_year)
select pg_temp.vu('hba' || n),
  case n when 1 then 'Survey Author' when 2 then 'Marie-Thérèse de la Longue-Particule-Hyphenée' else 'Survey Translator ' || n end,
  'heavy-survey-person-' || n, 'Person ' || n, 'Survey', 'Person ' || n, 1800 + n, 1870 + n
from generate_series(1, 12) n;
insert into series (id, title, slug) values (pg_temp.vu('hbs'), 'The Heavy Series', 'the-heavy-series');
insert into subjects (id, name, slug)
select pg_temp.vu('hbsu' || n), 'Heavy subject ' || n, 'heavy-subject-' || n from generate_series(1, 6) n;

-- The book, then its 29 sibling volumes (volume 3 is the book)
insert into works (id, title, slug, original_language, original_year, catalogue_status, rating, series_id, series_position, kind, is_rare, hunt_assessed_on, is_poison, acquisition_priority)
values (pg_temp.vu('hb-heavy'), 'The Survey Heavy Book', 'survey-heavy-book', 'fr', 1884, 'accessioned', 4.5,
  pg_temp.vu('hbs'), '3', 'book', true, current_date, true, 'none');
insert into works (id, title, slug, original_language, original_year, catalogue_status, rating, series_id, series_position, kind, is_rare, hunt_assessed_on, is_poison, acquisition_priority)
select pg_temp.vu('hbv' || n), 'Heavy Series Volume ' || n, 'heavy-series-volume-' || n, 'fr', 1870 + n, 'accessioned', (1 + n % 5)::numeric,
  pg_temp.vu('hbs'), n::text, 'book', n % 2 = 0, case when n % 2 = 0 then current_date end, n % 2 = 1, 'none'
from generate_series(1, 30) n where n <> 3;
insert into work_authors (work_id, author_id, role, sort_order) values
  (pg_temp.vu('hb-heavy'), pg_temp.vu('hba1'), 'author', 0), (pg_temp.vu('hb-heavy'), pg_temp.vu('hba2'), 'co_author', 1);
insert into work_authors (work_id, author_id, role, sort_order)
select pg_temp.vu('hbv' || n), pg_temp.vu('hba1'), 'author', 0 from generate_series(1, 30) n where n <> 3;
insert into work_subjects (work_id, subject_id) select pg_temp.vu('hb-heavy'), pg_temp.vu('hbsu' || n) from generate_series(1, 6) n;
insert into work_subjects (work_id, subject_id)
select pg_temp.vu('hbv' || n), pg_temp.vu('hbsu' || (1 + (n + k) % 6)) from generate_series(1, 30) n, generate_series(0, 1) k where n <> 3;
insert into editions (id, work_id, title, language, page_count, publication_year, publisher)
select pg_temp.vu('hbve' || n), pg_temp.vu('hbv' || n), 'Heavy Series Volume ' || n, 'fr', 200 + n, 1900 + n, 'Heavy House'
from generate_series(1, 30) n where n <> 3;

-- The book's editions, copies, readings and notes
insert into editions (id, work_id, title, language, page_count, publication_year, publisher, isbn_13, binding)
select pg_temp.vu('hbe' || n), pg_temp.vu('hb-heavy'),
  case when n = 4 then 'The Survey Heavy Book: The Complete and Unabridged Text, Newly Translated with an Introduction, Notes and Appendices'
       when n = 1 then 'Le Livre lourd de l''enquête' else 'The Survey Heavy Book (' || n || ')' end,
  (array['fr','en','de','es','it','nl','ru','la','pt','ja','en','fr'])[n], 120 + n * 37, 1850 + n * 13, 'Survey House ' || n,
  '979' || lpad((n * 104729)::text, 10, '0'), (array['paperback','hardcover'])[1 + n % 2]
from generate_series(1, 12) n;
insert into edition_contributors (edition_id, author_id, role, sort_order)
select pg_temp.vu('hbe' || n), pg_temp.vu('hba' || n), 'translator', 0 from generate_series(3, 12) n;
-- Each translator also translated a sibling volume, and the siblings come from two of the book's three publishers
insert into edition_contributors (edition_id, author_id, role, sort_order)
select pg_temp.vu('hbve' || (n + 10)), pg_temp.vu('hba' || n), 'translator', 0 from generate_series(3, 12) n;
insert into publishing_houses (id, name, slug, country)
select pg_temp.vu('hbp' || n), (array['Heavy Press', 'Survey Press', 'Third Press'])[n], 'heavy-survey-house-' || n, 'FR'
from generate_series(1, 3) n;
insert into edition_publishers (edition_id, publisher_id)
select pg_temp.vu('hbe' || n), pg_temp.vu('hbp' || (1 + n % 3)) from generate_series(1, 12) n
on conflict do nothing;
insert into edition_publishers (edition_id, publisher_id)
select pg_temp.vu('hbve' || n), pg_temp.vu('hbp' || (1 + n % 2)) from generate_series(1, 30) n where n <> 3
on conflict do nothing;
insert into instances (id, edition_id, location_id, format, condition, status, lent_to, lent_date, is_signed, signed_by, is_first_printing, acquisition_date, acquisition_price, acquisition_currency, notes)
select pg_temp.vu('hbi' || c), pg_temp.vu('hbe' || (1 + c % 12)), (select id from locations where is_active order by name limit 1 offset (c % 2)),
  (array['paperback','hardcover','paperback'])[1 + c % 3], (array['fine','good','fair','poor'])[1 + c % 4],
  (array['available','lent_out','in_transit','in_storage','missing','damaged','available'])[1 + c % 7]::instance_status_enum,
  case when c % 7 = 1 then 'A friend with a rather long name, Marie-Thérèse de Saint-Exupéry' end, case when c % 7 = 1 then current_date - 30 end,
  c % 5 = 0, case when c % 5 = 0 then 'The author' end, c % 4 = 0, current_date - c * 40, 10 + c, 'EUR',
  case when c % 3 = 0 then 'A note about this copy that runs for a sentence or two, to see how it wraps on a phone.' end
from generate_series(1, 16) c;
insert into readings (id, work_id, edition_id, format, status, started_on, started_precision, finished_on, finished_precision, unit, total_pages, current_page, rating, abandon_reason) values
  (pg_temp.vu('hbr1'), pg_temp.vu('hb-heavy'), pg_temp.vu('hbe1'), 'print', 'finished', '2019-03-02', 'day', '2019-04-11', 'day', 'pages', 157, 157, 4.5, null),
  (pg_temp.vu('hbr2'), pg_temp.vu('hb-heavy'), pg_temp.vu('hbe2'), 'print', 'finished', '2022-05-01', 'month', '2022-06-01', 'month', 'pages', 194, 194, 4, null),
  (pg_temp.vu('hbr3'), pg_temp.vu('hb-heavy'), pg_temp.vu('hbe3'), 'print', 'abandoned', '2023-09-10', 'day', '2023-10-01', 'day', 'pages', 231, 80, null, 'lost_interest'),
  (pg_temp.vu('hbr4'), pg_temp.vu('hb-heavy'), pg_temp.vu('hbe4'), 'print', 'reading', '2026-10-01', 'day', null, 'unknown', 'pages', 268, 120, null, null);
insert into reading_notes (id, work_id, reading_id, edition_id, kind, body, page, chapter, created_at)
select pg_temp.vu('hbn' || n), pg_temp.vu('hb-heavy'), pg_temp.vu('hbr' || (1 + n % 4)), pg_temp.vu('hbe' || (1 + n % 4)), case when n % 3 = 0 then 'note' else 'quote' end,
  case when n % 7 = 0 then repeat('A long passage copied from the book, the kind that runs on for several lines. ', 6) else 'Quote number ' || n || ' from the book.' end,
  5 * n, case when n % 4 = 0 then 'Chapter ' || (n / 4) end, now() - (n || ' days')::interval
from generate_series(1, 40) n;

-- Its collections and recommenders
insert into collections (id, name, sort_order) select pg_temp.vu('hbc' || n), 'Heavy Collection ' || n, 900 + n from generate_series(1, 10) n;
insert into collection_works (collection_id, work_id, sort_order) select pg_temp.vu('hbc' || n), pg_temp.vu('hb-heavy'), 0 from generate_series(1, 10) n;
insert into recommenders (id, name)
select pg_temp.vu('hbrec' || n), 'Heavy Recommender ' || n || case when n = 5 then ' and the Society of Very Long Recommender Names' else '' end
from generate_series(1, 5) n;
insert into work_recommenders (work_id, recommender_id) select pg_temp.vu('hb-heavy'), pg_temp.vu('hbrec' || n) from generate_series(1, 5) n;
commit;
analyze;

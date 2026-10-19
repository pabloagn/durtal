-- Scale seed: about 5,000 books, 1,500 people, 300 publishers, 250 series,
-- 60 collections and 600 venues, for timing and page-weight checks at scale
-- (the 16 Oct page survey and its 18 Oct recheck). Disposable preview
-- databases only:
--   docker exec -i <durtal-preview container> psql -U durtal_preview -d durtal_preview < scripts/qa/seed-scale.sql
-- Ids are valid version-4 UUIDs derived from a name (seed_uuid), so the seed
-- can refer to its own rows; never md5(...)::uuid, which z.uuid() refuses
-- (SLN-1167). No live data.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'durtal_preview' then raise exception 'disposable preview database only'; end if;
end $$;
create function pg_temp.seed_uuid(t text) returns text language sql immutable as $f$
  select left(md5(t), 12) || '4' || substr(md5(t), 14, 3) || 'a' || substr(md5(t), 18)
$f$;

begin;
-- People: 1,500 book authors (the first two prolific), 300 translators among them
insert into authors (id, name, slug, sort_name, first_name, last_name, birth_year, death_year, bio)
select pg_temp.seed_uuid('sa' || i)::uuid,
  case when i = 1 then 'Honoré de Balzac-Scale' when i = 2 then 'Georges Simenon-Scale'
       else 'Scale Author ' || i || case when i % 7 = 0 then ' de la Longue-Particule-Hyphenée' else '' end end,
  'scale-author-' || i, 'Author ' || i, 'Scale', 'Author ' || i,
  1700 + (i * 37) % 300, case when i % 3 = 0 then null else 1760 + (i * 37) % 260 end,
  case when i % 4 = 0 then repeat('A long biography sentence about this writer and their circle. ', 12) end
from generate_series(1, 1500) i;
-- Publishers
insert into publishing_houses (id, name, slug, country)
select pg_temp.seed_uuid('sp' || i)::uuid, 'Scale House ' || i || case when i % 9 = 0 then ' & Sons Publishing Company Limited' else '' end,
  'scale-house-' || i, (array['FR','GB','US','DE','ES','IT','NL'])[1 + i % 7]
from generate_series(1, 300) i;
-- Series
insert into series (id, title, slug, total_volumes)
select pg_temp.seed_uuid('ss' || i)::uuid, 'Scale Series ' || i, 'scale-series-' || i, 5 + i % 16 from generate_series(1, 250) i;
-- Works: 5,000 books
insert into works (id, title, slug, original_language, original_year, catalogue_status, rating, series_id, series_position, kind, is_rare, hunt_assessed_on, is_poison, acquisition_priority, created_at)
select pg_temp.seed_uuid('sw' || i)::uuid,
  case when i % 11 = 0 then 'The Long and Winding Account of Scale Book ' || i || ', Being a Faithful Narrative in Several Volumes'
       else 'Scale Book ' || i end,
  'scale-book-' || i,
  (array['en','fr','de','es','it','nl','ru','la'])[1 + i % 8],
  1500 + (i * 13) % 526,
  (case when i % 10 < 7 then 'accessioned' when i % 10 = 7 then 'wanted' when i % 10 = 8 then 'shortlisted' else 'tracked' end)::catalogue_status_enum,
  case when i % 5 < 3 then 1 + (i % 9) * 0.5 end,
  case when i % 5 = 0 then pg_temp.seed_uuid('ss' || (1 + i % 250))::uuid end,
  case when i % 5 = 0 then (1 + (i / 250) % 20)::text end,
  'book', i % 50 = 0, case when i % 50 = 0 then current_date end, i % 97 = 0,
  (array['none','low','medium','high','urgent'])[1 + i % 5]::acquisition_priority_enum,
  now() - (i || ' hours')::interval
from generate_series(1, 5000) i;
-- Authors: works 1-400 by the first, 401-550 by the second, the rest spread; 10% have a co-author
insert into work_authors (work_id, author_id, role, sort_order)
select pg_temp.seed_uuid('sw' || i)::uuid,
  pg_temp.seed_uuid('sa' || case when i <= 400 then 1 when i <= 550 then 2 else 3 + (i * 7) % 1498 end)::uuid, 'author', 0
from generate_series(1, 5000) i;
insert into work_authors (work_id, author_id, role, sort_order)
select pg_temp.seed_uuid('sw' || i)::uuid, pg_temp.seed_uuid('sa' || (3 + (i * 11) % 1498))::uuid, 'co_author', 1
from generate_series(1, 5000) i where i % 10 = 0 and (3 + (i * 11) % 1498) <> (3 + (i * 7) % 1498);
-- Editions: one per work, a second for every third work
insert into editions (id, work_id, title, language, page_count, publication_year, publisher, isbn_13, binding)
select pg_temp.seed_uuid('se' || i || '-' || n)::uuid, pg_temp.seed_uuid('sw' || i)::uuid,
  case when i % 11 = 0 then 'The Long and Winding Account of Scale Book ' || i else 'Scale Book ' || i end,
  (array['en','fr','de','es','it','nl','ru','la'])[1 + (i + n) % 8], 80 + (i * 17 + n * 31) % 900,
  1800 + (i * 7 + n) % 226, 'Scale House ' || (1 + (i + n * 3) % 300),
  '978' || lpad(((i * 10 + n)::bigint * 7919 % 9999999999)::text, 10, '0'),
  (array['paperback','hardcover','paperback'])[1 + (i + n) % 3]
from generate_series(1, 5000) i cross join generate_series(1, 2) n where n = 1 or i % 3 = 0;
insert into edition_publishers (edition_id, publisher_id)
select e.id, pg_temp.seed_uuid('sp' || (1 + (substring(e.title from '([0-9]+)')::int + case when e.id = pg_temp.seed_uuid('se' || substring(e.title from '([0-9]+)') || '-1')::uuid then 3 else 6 end) % 300))::uuid
from editions e where e.title like 'Scale Book %' or e.title like 'The Long and Winding Account of Scale Book %'
on conflict do nothing;
-- Translators on a fifth of editions
insert into edition_contributors (edition_id, author_id, role, sort_order)
select pg_temp.seed_uuid('se' || i || '-1')::uuid, pg_temp.seed_uuid('sa' || (1200 + i % 300))::uuid, 'translator', 0
from generate_series(1, 5000) i where i % 5 = 1;
-- Copies for accessioned works
insert into instances (edition_id, location_id, format, condition, status)
select pg_temp.seed_uuid('se' || i || '-1')::uuid, (select id from locations where is_active order by name limit 1 offset (i % 2)),
  'paperback', 'good', 'available'
from generate_series(1, 5000) i where i % 10 < 7;
-- Collections: 60, 30 to 300 works each
insert into collections (id, name, sort_order)
select pg_temp.seed_uuid('sc' || c)::uuid, 'Scale Collection ' || c, c from generate_series(1, 60) c;
insert into collection_works (collection_id, work_id, sort_order)
select pg_temp.seed_uuid('sc' || c)::uuid, pg_temp.seed_uuid('sw' || (1 + (c * 83 + k * 17) % 5000))::uuid, k
from generate_series(1, 60) c cross join generate_series(1, 300) k where k <= 30 + (c * 47) % 271
on conflict do nothing;
-- Taxonomy: 80 tags on editions, 40 subjects and 30 themes on works
insert into tags (id, name, slug) select pg_temp.seed_uuid('st' || t)::uuid, 'Scale tag ' || t, 'scale-tag-' || t from generate_series(1, 80) t;
insert into edition_tags (edition_id, tag_id)
select pg_temp.seed_uuid('se' || i || '-1')::uuid, pg_temp.seed_uuid('st' || (1 + (i * k) % 80))::uuid from generate_series(1, 5000) i cross join generate_series(1, 3) k on conflict do nothing;
insert into subjects (id, name, slug) select pg_temp.seed_uuid('su' || t)::uuid, 'Scale subject ' || t, 'scale-subject-' || t from generate_series(1, 40) t;
insert into work_subjects (work_id, subject_id)
select pg_temp.seed_uuid('sw' || i)::uuid, pg_temp.seed_uuid('su' || (1 + (i * k) % 40))::uuid from generate_series(1, 5000) i cross join generate_series(1, 2) k on conflict do nothing;
-- Venues: 600 places of every type
insert into venues (id, name, slug, type, formatted_address, notes)
select pg_temp.seed_uuid('sv' || v)::uuid, 'Scale Venue ' || v, 'scale-venue-' || v,
  (array['bookshop','online_store','cafe','library','museum','gallery','auction_house','market','fair','publisher','cinema','perfumery'])[1 + v % 12]::venue_type_enum,
  v || ' Rue de la Scale, Paris', case when v % 5 = 0 then 'Notes about this place.' end
from generate_series(1, 600) v;
commit;
-- One publisher with 700 more editions
begin;
insert into edition_publishers (edition_id, publisher_id)
select e.id, pg_temp.seed_uuid('sp1')::uuid from editions e where e.title like 'Scale Book %' order by e.id limit 700 on conflict do nothing;
update editions set publisher = 'Scale House 1' where id in (select edition_id from edition_publishers where publisher_id = pg_temp.seed_uuid('sp1')::uuid);
commit;
analyze;
-- Then Settings > Data > Refresh cached data, so the cached lists see the new records.

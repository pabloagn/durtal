-- A large mixed catalogue for timing checks, on a disposable preview database
-- only (scripts/qa/preview-local.py --seed-large N). Adds N perfumes, N films
-- and N paintings beside whatever the database already holds, with the shapes
-- that cost the most to read:
--   perfumes   three formulations each, a house (a manufacturer for every
--              third), two perfumers, twelve positioned notes, two families,
--              a bottle for every second one
--   films      a director, two screenwriters and 140 cast credits with
--              characters, two cuts, two countries, two languages, a
--              production company, two genres, a copy
--   paintings  a museum-owned original with six location records (five
--              closed, one current), a painter, a movement, two genres, a
--              personal reproduction for every fourth one
-- max(600, 10N) people credit works of all three kinds, so person pages span
-- domains and each person has about as many credits as in a real catalogue.
-- Every name starts with "Seed". psql variable :n is the count per kind.

\set ON_ERROR_STOP on
select greatest(count(*), 1) as countries from countries \gset
select greatest(count(*), 1) as languages from languages \gset
select greatest(count(*), 1) as movements from art_movements \gset
select greatest(600, :n * 10) as people \gset
begin;

-- Shared people, organizations, museums and vocabulary
create temp table seed_people on commit drop as
  select gen_random_uuid() as id, i from generate_series(1, :people) i;
insert into authors(id, name, slug)
  select id, 'Seed Person ' || i, 'seed-person-' || i from seed_people;
-- As the app does: the insert trigger's book membership gives way to the
-- person's real domains, so these people are not book authors
delete from person_domains where person_id in (select id from seed_people) and kind = 'book';
insert into person_domains(person_id, kind)
  select p.id, k::work_kind_enum from seed_people p, unnest(array['perfume', 'film', 'painting']) k
  on conflict do nothing;

create temp table seed_orgs on commit drop as
  select gen_random_uuid() as id, i from generate_series(1, 80) i;
insert into publishing_houses(id, name, slug, kind)
  select id, 'Seed Organization ' || i, 'seed-organization-' || id, null from seed_orgs;
insert into organization_roles(organization_id, role)
  select o.id, r from seed_orgs o, unnest(array['perfume_house', 'manufacturer', 'production_company', 'museum']) r;

create temp table seed_venues on commit drop as
  select gen_random_uuid() as id, i from generate_series(1, 60) i;
insert into venues(id, name, slug, type)
  select id, 'Seed Museum ' || i, 'seed-museum-' || i, 'museum' from seed_venues;

create temp table seed_terms on commit drop as
  select gen_random_uuid() as id, f.id as family_id, f.slug as family, i
  from taxonomy_families f, generate_series(1, 120) i
  where f.slug in ('perfume-notes', 'perfume-families', 'film-genres', 'painting-genres');
insert into custom_taxonomy_items(id, family_id, name, slug)
  select id, family_id, 'Seed ' || family || ' ' || i, 'seed-' || family || '-' || i from seed_terms;

-- Picks the k-th member of a pool for record i, spread so neighbours differ
create function pg_temp.pick(pool int, i int, k int) returns int language sql immutable
  as $$ select 1 + ((i * 7919 + k * 104729) % pool) $$;

-- Perfumes
create temp table seed_perfumes on commit drop as
  select gen_random_uuid() as id, gen_random_uuid() as released, i from generate_series(1, :n) i;
insert into works(id, kind, title, slug, original_language, rating, is_favourite)
  select id, 'perfume', 'Seed Perfume ' || i, 'seed-perfume-' || i, null,
    nullif(i % 6, 0), i % 7 = 0 from seed_perfumes;
insert into catalogue_dates(id, precision, start_year)
  select released, 'year', 1900 + i % 125 from seed_perfumes;
insert into perfume_details(work_id, release_date_id) select id, released from seed_perfumes;
insert into perfume_variants(work_id, concentration)
  select p.id, c from seed_perfumes p, unnest(array['eau_de_parfum', 'eau_de_toilette', 'extrait']) c;
insert into perfume_organizations(work_id, organization_id, role, sort_order)
  select p.id, o.id, 'perfume_house', 0 from seed_perfumes p join seed_orgs o on o.i = pg_temp.pick(80, p.i, 0);
insert into perfume_organizations(work_id, organization_id, role, sort_order)
  select p.id, o.id, 'manufacturer', 0 from seed_perfumes p join seed_orgs o on o.i = pg_temp.pick(80, p.i, 1)
  where p.i % 3 = 0;
insert into work_credits(work_id, person_id, role_id, sort_order)
  select p.id, s.id, 'perfume.perfumer', k from seed_perfumes p cross join generate_series(0, 1) k
  join seed_people s on true where s.i = pg_temp.pick(:people, p.i, k);
insert into perfume_notes(work_id, item_id, position, sort_order)
  select distinct on (p.id, t.id, pos) p.id, t.id, pos, k
  from seed_perfumes p cross join generate_series(0, 11) k
  cross join lateral (select (array['top', 'heart', 'base'])[1 + k / 4] as pos) x
  join seed_terms t on t.family = 'perfume-notes' and t.i = pg_temp.pick(120, p.i, k);
insert into custom_taxonomy_item_works(item_id, work_id)
  select distinct t.id, p.id from seed_perfumes p cross join generate_series(0, 1) k
  join seed_terms t on t.family = 'perfume-families' and true
  where t.i = pg_temp.pick(120, p.i, k);
insert into perfume_bottles(variant_id, container, capacity_value, volume_unit)
  select v.id, 'bottle', 50, 'ml' from seed_perfumes p
  join perfume_variants v on v.work_id = p.id and v.concentration = 'eau_de_parfum'
  where p.i % 2 = 0;

-- Films
create temp table seed_films on commit drop as
  select gen_random_uuid() as id, gen_random_uuid() as released, i from generate_series(1, :n) i;
insert into works(id, kind, title, slug, original_language, rating, is_favourite)
  select id, 'film', 'Seed Film ' || i, 'seed-film-' || i, null, nullif(i % 6, 0), i % 7 = 0 from seed_films;
insert into catalogue_dates(id, precision, start_year)
  select released, 'year', 1920 + i % 105 from seed_films;
insert into film_details(work_id, original_title, release_date_id)
  select id, case when i % 3 = 0 then 'Seed Original ' || i end, released from seed_films;
insert into film_versions(work_id, label, runtime_seconds, sort_order)
  select f.id, v.label, 5400 + f.i % 3600 + v.extra, v.ord from seed_films f,
    (values ('Theatrical cut', 0, 0), ('Director''s cut', 900, 1)) v(label, extra, ord);
insert into film_holdings(work_id, medium)
  select id, case when i % 2 = 0 then 'physical' else 'digital' end from seed_films;
insert into film_countries(work_id, country_id, sort_order)
  select f.id, c.id, k from seed_films f cross join generate_series(0, 1) k
  join lateral (select id from countries order by id offset pg_temp.pick(:countries, f.i, k) - 1 limit 1) c on true
  on conflict do nothing;
insert into film_languages(work_id, language_id, sort_order)
  select f.id, l.id, k from seed_films f cross join generate_series(0, 1) k
  join lateral (select id from languages order by id offset pg_temp.pick(:languages, f.i, k) - 1 limit 1) l on true
  on conflict do nothing;
insert into film_organizations(work_id, organization_id, role, sort_order)
  select f.id, o.id, 'production_company', 0 from seed_films f join seed_orgs o on o.i = pg_temp.pick(80, f.i, 2);
insert into custom_taxonomy_item_works(item_id, work_id)
  select distinct t.id, f.id from seed_films f cross join generate_series(0, 1) k
  join seed_terms t on t.family = 'film-genres' and true
  where t.i = pg_temp.pick(120, f.i, k);
insert into work_credits(work_id, person_id, role_id, characters, sort_order)
  select f.id, s.id,
    case when k = 0 then 'film.director' when k <= 2 then 'film.screenwriter' else 'film.cast' end,
    case when k > 2 then array['Seed Character ' || k] else '{}' end, k
  from seed_films f cross join generate_series(0, 142) k
  join seed_people s on true where s.i = pg_temp.pick(:people, f.i, k);

-- Paintings
create temp table seed_paintings on commit drop as
  select gen_random_uuid() as id, gen_random_uuid() as painted, gen_random_uuid() as original, i
  from generate_series(1, :n) i;
insert into works(id, kind, title, slug, original_language, rating, is_favourite)
  select id, 'painting', 'Seed Painting ' || i, 'seed-painting-' || i, null, nullif(i % 6, 0), i % 7 = 0
  from seed_paintings;
insert into catalogue_dates(id, precision, start_year)
  select painted, 'year', 1400 + i % 600 from seed_paintings;
insert into painting_details(work_id, creation_date_id) select id, painted from seed_paintings;
insert into art_objects(id, work_id, kind, ownership, owner_organization_id, height, width, dimension_unit)
  select p.id_original, p.id, 'original', 'institutional', o.id, 40 + p.i % 160, 30 + p.i % 120, 'cm'
  from (select original as id_original, id, i from seed_paintings) p
  join seed_orgs o on o.i = pg_temp.pick(80, p.i, 3);
insert into art_objects(work_id, kind, reproduces_object_id, ownership, holding_status)
  select id, 'reproduction', original, 'personal', 'held' from seed_paintings where i % 4 = 0;
insert into work_credits(work_id, person_id, role_id, sort_order)
  select p.id, s.id, 'painting.painter', 0 from seed_paintings p join seed_people s on s.i = pg_temp.pick(:people, p.i, 4);
insert into work_art_movements(work_id, art_movement_id)
  select p.id, m.id from seed_paintings p
  join lateral (select id from art_movements order by id offset pg_temp.pick(:movements, p.i, 5) - 1 limit 1) m on true;
insert into custom_taxonomy_item_works(item_id, work_id)
  select distinct t.id, p.id from seed_paintings p cross join generate_series(0, 1) k
  join seed_terms t on t.family = 'painting-genres' and true
  where t.i = pg_temp.pick(120, p.i, k);
-- Six location records per original: five closed decades, then the current one
create temp table seed_stays on commit drop as
  select p.original, p.i, k, gen_random_uuid() as starts, gen_random_uuid() as ends
  from seed_paintings p cross join generate_series(0, 5) k;
insert into catalogue_dates(id, precision, start_year)
  select starts, 'year', 1950 + k * 10 from seed_stays;
insert into catalogue_dates(id, precision, start_year)
  select ends, 'year', 1950 + k * 10 + 9 from seed_stays where k < 5;
insert into art_object_whereabouts(object_id, place_kind, venue_id, custody, display_status, certainty, starts_on_id, ends_on_id)
  select s.original, 'venue', v.id, case when k < 5 then 'temporary_loan' else 'permanent_collection' end,
    case when k = 5 then 'on_display' else 'unknown' end, 'confirmed', s.starts, case when k < 5 then s.ends end
  from seed_stays s join seed_venues v on v.i = pg_temp.pick(60, s.i, s.k);

analyze;
commit;

select 'seeded ' || (select count(*) from works where title like 'Seed %') || ' works, '
  || (select count(*) from work_credits c join works w on w.id = c.work_id where w.title like 'Seed %') || ' credits, '
  || (select count(*) from art_object_whereabouts) || ' location records';

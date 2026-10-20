-- Saved reading places for the /ebooks/* page-weight row, on a disposable
-- preview database only (scripts/qa/preview-local.py --seed-places N, after
-- --seed-reader or --ebooks M). The first e-book with a stored file, by
-- title, gets N places from N device ids under 40 device names, the newest just now, so it is the
-- first e-book on /ebooks?sort=opened and page-weight.json measures its
-- page through that list (SLN-665). psql variable :n is the number of places.

\set ON_ERROR_STOP on
-- Never on any database but the disposable preview's
do $$ begin
  if current_database() <> 'durtal_preview' then
    raise exception 'seed-places.sql runs on the disposable preview database only (durtal_preview), not %', current_database();
  end if;
end $$;

insert into ebook_positions (ebook_id, file_id, device_id, device_label, locator, progression, furthest_progression, chapter, client_updated_at)
select b.ebook_id, b.file_id, gen_random_uuid()::text, 'Seed device ' || (d % 40 + 1),
  jsonb_build_object('v', 1, 'fileHash', b.sha256, 'href', 'chapter-1.xhtml', 'sectionIndex', 0,
    'progression', (d % 100) / 100.0, 'totalProgression', (d % 100) / 100.0),
  (d % 100) / 100.0, (d % 100) / 100.0, 'Chapter ' || (d % 40 + 1), now() - (d || ' minutes')::interval
from (
  select e.id as ebook_id, f.id as file_id, f.sha256
  from ebooks e join lateral (
    select id, sha256 from ebook_files where ebook_id = e.id and status = 'stored' order by created_at, id limit 1
  ) f on true
  order by e.title, e.id limit 1
) b cross join generate_series(1, :n) d
on conflict (file_id, device_id) do nothing;

select format('Seeded %s places on %s', count(*), min(e.title)) from ebook_positions p join ebooks e on e.id = p.ebook_id
where p.device_label like 'Seed device %';

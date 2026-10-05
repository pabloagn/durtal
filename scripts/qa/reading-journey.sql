-- The reading journey's book (scripts/qa/journeys.mjs reading), for a
-- disposable preview database only (SLN-447): a book with two print editions
-- of different page counts and an audiobook, a paperback on a shelf in
-- Amsterdam, and a series whose next volume has a copy on that shelf.
--   docker exec -i <container> psql -U durtal_preview -d durtal_preview < scripts/qa/reading-journey.sql
do $$
declare
  ams uuid; shelf uuid; audible uuid; s uuid; w uuid; nxt uuid; e600 uuid; e480 uuid; eaudio uuid; enext uuid;
begin
  select id into ams from locations where name = 'Amsterdam' and type = 'physical' limit 1;
  if ams is null then
    insert into locations(name, type) values ('Amsterdam', 'physical') returning id into ams;
  end if;
  insert into sub_locations(location_id, name) values (ams, 'Study, shelf 3') returning id into shelf;
  insert into locations(name, type) values ('Journey audiobooks', 'digital') returning id into audible;
  insert into series(title, slug) values ('Journey Series', 'journey-series') returning id into s;
  insert into works(title, slug, series_id, series_position) values ('Journey Reading', 'journey-reading', s, '1') returning id into w;
  insert into works(title, slug, series_id, series_position) values ('Journey Sequel', 'journey-sequel', s, '2') returning id into nxt;
  insert into editions(work_id, title, language, page_count, publication_year) values (w, 'Journey Reading', 'en', 600, 2001) returning id into e600;
  insert into editions(work_id, title, language, page_count, publication_year) values (w, 'Journey Reading, pocket', 'en', 480, 2010) returning id into e480;
  insert into editions(work_id, title, language, page_count, publication_year) values (w, 'Journey Reading, audio', 'en', null, 2015) returning id into eaudio;
  insert into instances(edition_id, location_id, sub_location_id, format, status) values (e600, ams, shelf, 'paperback', 'available');
  insert into instances(edition_id, location_id, format, status) values (eaudio, audible, 'audiobook', 'available');
  insert into editions(work_id, title, language, page_count) values (nxt, 'Journey Sequel', 'en', 300) returning id into enext;
  insert into instances(edition_id, location_id, sub_location_id, format, status) values (enext, ams, shelf, 'paperback', 'available');
  -- Three books for Up Next (SLN-452)
  for i in 1..3 loop
    insert into works(title, slug) values ('Queue Journey ' || (array['One', 'Two', 'Three'])[i], 'queue-journey-' || i) returning id into w;
    insert into editions(work_id, title, language, page_count) values (w, 'Queue Journey', 'en', 100 * i) returning id into e600;
    insert into instances(edition_id, location_id, sub_location_id, format, status) values (e600, ams, shelf, 'paperback', 'available');
  end loop;
end $$;

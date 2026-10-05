-- The reading import journey's books (scripts/qa/journeys.mjs import), for a
-- disposable preview database only (SLN-450): a book found by its edition's
-- Goodreads id, one by ISBN with a rating of 3, one by its Goodreads link,
-- one to stop reading, two books of one title by two authors, and a to-read
-- book for Up Next.
--   docker exec -i <container> psql -U durtal_preview -d durtal_preview < scripts/qa/reading-import-journey.sql
do $$
declare
  a uuid; o uuid; w uuid;
begin
  insert into authors(name, slug, first_name, last_name) values ('Journey Author', 'import-journey-author', 'Journey', 'Author') returning id into a;
  insert into authors(name, slug, first_name, last_name) values ('Other Writer', 'import-journey-other', 'Other', 'Writer') returning id into o;

  insert into works(title, slug) values ('Import Journey Reread', 'import-journey-reread') returning id into w;
  insert into work_authors(work_id, author_id, role) values (w, a, 'author');
  insert into editions(work_id, title, language, page_count, goodreads_id) values (w, 'Import Journey Reread', 'en', 320, '9000001');

  insert into works(title, slug, rating) values ('Import Journey Rated', 'import-journey-rated', 3) returning id into w;
  insert into work_authors(work_id, author_id, role) values (w, a, 'author');
  insert into editions(work_id, title, language, page_count, isbn_13) values (w, 'Import Journey Rated', 'en', 210, '9780000000019');

  insert into works(title, slug, goodreads_url) values ('Import Journey Current', 'import-journey-current', 'https://www.goodreads.com/book/show/9000003.Import_Journey_Current') returning id into w;
  insert into work_authors(work_id, author_id, role) values (w, a, 'author');
  insert into editions(work_id, title, language, page_count) values (w, 'Import Journey Current', 'en', 400);

  insert into works(title, slug) values ('Import Journey Dropped', 'import-journey-dropped') returning id into w;
  insert into work_authors(work_id, author_id, role) values (w, a, 'author');
  insert into editions(work_id, title, language, goodreads_id) values (w, 'Import Journey Dropped', 'en', '9000004');

  -- A to-read book for Up Next (SLN-452)
  insert into works(title, slug) values ('Import Journey Shelf', 'import-journey-shelf') returning id into w;
  insert into work_authors(work_id, author_id, role) values (w, a, 'author');
  insert into editions(work_id, title, language, page_count) values (w, 'Import Journey Shelf', 'en', 250);

  insert into works(title, slug) values ('Import Journey Twin', 'import-journey-twin-by-journey-author') returning id into w;
  insert into work_authors(work_id, author_id, role) values (w, a, 'author');
  insert into works(title, slug) values ('Import Journey Twin', 'import-journey-twin-by-other-writer') returning id into w;
  insert into work_authors(work_id, author_id, role) values (w, o, 'author');
end $$;

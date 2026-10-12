-- Reader marks for the /ebooks/highlights page-weight rows, on a disposable
-- preview database only (scripts/qa/preview-local.py --seed-highlights N,
-- after --seed-reader or --ebooks M). The first N e-books with a stored file,
-- by title, get seven marks each in the shapes the list draws: a highlight
-- longer than the list shows (cut), a short one, ordinary ones of about 300
-- characters, a note, a note longer than the list shows (cut), a mark the
-- reader could not place, and a bookmark. The first of them also gets 400
-- more ordinary highlights, every fourth with a note, made last so it is the
-- newest book: its "All N in this book" link is the first on the page, and
-- page-weight.json measures that one-book page through it. psql variable :n
-- is the number of books.

\set ON_ERROR_STOP on
-- Never on any database but the disposable preview's
do $$ begin
  if current_database() <> 'durtal_preview' then
    raise exception 'seed-highlights.sql runs on the disposable preview database only (durtal_preview), not %', current_database();
  end if;
end $$;

create temporary table seed_marked_books as
  select e.id as ebook_id, f.id as file_id, f.sha256, row_number() over (order by e.title, e.id) as n
  from ebooks e join lateral (
    select id, sha256 from ebook_files where ebook_id = e.id and status = 'stored' order by created_at, id limit 1
  ) f on true
  order by e.title, e.id limit :n;

-- One highlight's place in its file; the reader re-resolves it from the text
create function pg_temp.seed_locator(sha256 text, progression numeric, highlight text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('v', 1, 'fileHash', sha256, 'href', 'chapter-1.xhtml', 'sectionIndex', 0,
    'progression', progression, 'totalProgression', progression)
    || case when highlight is null then '{}'::jsonb else jsonb_build_object('text', jsonb_build_object('highlight', highlight)) end
$$;

insert into ebook_annotations (ebook_id, file_id, kind, color, text, note, chapter, locator, progression, client_updated_at, anchor_state)
select b.ebook_id, b.file_id, m.kind, m.color, m.text, m.note, m.chapter,
  pg_temp.seed_locator(b.sha256, m.k / 10.0, m.text), m.k / 10.0, now() - (b.n || ' hours')::interval, m.anchor
from seed_marked_books b
cross join lateral (values
  (1, 'highlight', 'ochre', repeat('He had dreamed of a refined solitude, a comfortable desert, a motionless ark in which to seek refuge. ', 7), null, 'Chapter One', 'exact'),
  (2, 'highlight', 'sage', 'The tortoise.', null, null, 'exact'),
  (3, 'highlight', 'rose', repeat('Artifice was, in his eyes, the distinctive mark of human genius, ', 4) || b.n, 'A note on this passage, with its own thoughts that also wrap across a couple of lines on a phone.', 'Chapter Two', 'healed'),
  (4, 'highlight', 'slate', repeat('The bells of Saint-Sulpice rang over the square at dusk, ', 5), repeat('A long note that runs past what the list shows, so the cut is measured too. ', 11), 'Chapter Three', 'exact'),
  (5, 'highlight', 'violet', repeat('A passage the reader could not place again in this file. ', 5), null, null, 'orphaned'),
  (6, 'highlight', 'ochre', repeat('Nature, he used to say, has had her day; ', 7), null, 'Chapter Six', 'approximate'),
  (7, 'bookmark', null, null, null, 'Chapter Seven', 'exact')
) as m(k, kind, color, text, note, chapter, anchor)
order by b.n desc, m.k;

insert into ebook_annotations (ebook_id, file_id, kind, color, text, note, chapter, locator, progression, client_updated_at)
select b.ebook_id, b.file_id, 'highlight', 'sage', t.text,
  case when g % 4 = 0 then repeat('A reader''s note on this passage. ', 5) end,
  'Chapter ' || (g / 20 + 1), pg_temp.seed_locator(b.sha256, g / 401.0, t.text), g / 401.0, now() - ((400 - g) || ' seconds')::interval
from seed_marked_books b
cross join generate_series(1, 400) g
cross join lateral (select 'Passage ' || g || ': ' || repeat('Durtal climbed the tower stairs as the light failed, ', 5) as text) t
where b.n = 1
order by g;

select count(distinct ebook_id) as "marked books", count(*) as marks from ebook_annotations;

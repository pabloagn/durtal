-- The review queue for the /ebooks/review page-weight row, on a disposable
-- preview database only (scripts/qa/preview-local.py --seed-review, after
-- --ebooks M). Pending e-books with no tier are spread over the queue's
-- sections in turn, and those whose section proposes books get one to three
-- candidates with reasons, so the page draws its fullest rows (SLN-684).

\set ON_ERROR_STOP on
-- Never on any database but the disposable preview's
do $$ begin
  if current_database() <> 'durtal_preview' then
    raise exception 'seed-review.sql runs on the disposable preview database only (durtal_preview), not %', current_database();
  end if;
end $$;

create temporary table seed_review_rows as
  select e.id as ebook_id, (array['likely','to_choose','conflict','same_author','duplicate','not_a_book','not_in_durtal'])[1 + (row_number() over (order by e.title, e.id) - 1) % 7] as tier,
    row_number() over (order by e.title, e.id) as n
  from ebooks e where e.match_state = 'pending' and e.match_tier is null;

update ebooks e set match_tier = r.tier, match_model_version = 1, match_probability = 0.5
from seed_review_rows r where e.id = r.ebook_id;

create temporary table seed_review_works as
  select w.id, row_number() over (order by w.title, w.id) as n, count(*) over () as total from works w where w.kind = 'book';

insert into ebook_match_candidates (ebook_id, rank, work_id, edition_rule, probability, weight_bits, margin_bits, reasons, flags, model_version)
select r.ebook_id, k, w.id, 'new_edition', greatest(0.05, 0.9 - k * 0.2), 10 - k * 2, case when k = 1 then 2 end,
  '[{"code":"title","text":"Similar title, ignoring case and accents"},{"code":"author","text":"An author with the same name"},{"code":"language","text":"Same language"}]'::jsonb,
  case when r.tier = 'conflict' and k = 1 then array['shared_isbn'] else array[]::text[] end, 1
from seed_review_rows r
cross join generate_series(1, 3) k
join seed_review_works w on w.n = 1 + ((r.n * 7 + k) % w.total)
where r.tier in ('likely','to_choose','conflict','same_author') and k <= case r.tier when 'likely' then 1 when 'same_author' then 2 else 3 end;

select format('Review queue: %s e-books in sections, %s candidates', (select count(*) from seed_review_rows),
  (select count(*) from ebook_match_candidates c join seed_review_rows r on r.ebook_id = c.ebook_id));

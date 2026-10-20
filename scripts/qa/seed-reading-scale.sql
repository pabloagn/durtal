-- A long reading history for speed checks (SLN-1309), on top of a scale seed with
-- 3,400 books or more (scripts/qa/seed-scale.sql).
-- Private preview databases only.
-- 4,000 readings over 3,400 books (600 read twice), 2018 to 2026, with a
-- mix of formats, statuses, ratings and audiobooks without a page count;
-- 12,000 sessions, three a reading, one in twenty a year after its finish.
with b as (
  select w.id, row_number() over (order by w.id) as n from works w where w.kind = 'book' order by w.id limit 3400
), r as (
  select b.id as work_id, b.n, g as pass, (b.n * 7 + g * 13) % 100 as k from b cross join generate_series(1, 2) g where g = 1 or b.n <= 600
)
insert into readings(work_id, status, format, started_on, started_precision, finished_on, finished_precision, total_pages, rating, abandon_reason, source_key)
select work_id,
  case when k < 5 then 'abandoned' else 'finished' end,
  case when k % 10 < 6 then 'print' when k % 10 < 9 then 'ebook' else 'audio' end,
  date '2018-01-01' + ((n * 37 + pass * 400) % 3100)::int,
  'day',
  case when k between 95 and 96 then null else date '2018-01-01' + ((n * 37 + pass * 400) % 3100)::int + 5 + (k % 40)::int end,
  case when k between 95 and 96 then 'unknown' when k = 97 then 'year' when k = 98 then 'month' else 'day' end,
  case when k % 10 = 9 and k % 3 = 0 then null else 120 + (n * 11) % 700 end,
  case when k % 4 = 0 then null else 0.5 * (1 + (n + pass * 3) % 10) end,
  case when k < 5 then 'lost_interest' end,
  'scale-reading:' || work_id || ':' || pass
from r;

update works w set rating = 0.5 * (1 + (abs(hashtext(w.id::text)) % 10))
where w.id in (select work_id from readings where source_key like 'scale-reading:%') and abs(hashtext(w.id::text)) % 3 = 0;

insert into reading_sessions(reading_id, format, source, read_on, time_zone, duration_seconds, pages_total, start_percent, end_percent)
select r.id, r.format, 'manual',
  coalesce(r.finished_on, r.started_on + 20) - (3 - g) * 2 + case when abs(hashtext(r.id::text)) % 20 = 0 and g = 3 then 365 else 0 end,
  'Europe/Amsterdam', 1200 + g * 300, r.total_pages, (g - 1) * 33, g * 33
from readings r cross join generate_series(1, 3) g
where r.source_key like 'scale-reading:%';

analyze readings;
analyze reading_sessions;
analyze works;

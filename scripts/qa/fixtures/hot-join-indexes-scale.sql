-- SLN-935 replacement fixture. Deterministic synthetic data, not the lost
-- historical survey seed. Apply only after genuine migrations to an empty,
-- explicitly owned, loopback-only disposable database named sln935_scale.
-- The calling harness must check the full URL; SQL checks the database and
-- emptiness too. No rows are deleted and a repeat application fails closed.
--
-- 5,006 works (5,000 books + 6 paintings), 5,503 people, 5,000 editions.
-- Junction rows: 6,000 work credits; 6,666 edition credits; 10,000 edition
-- tags; 15,000 work subjects; 10,000 custom-item links; 12 movement links.
-- "scale" matches 5,000 people; "contributor" matches 503; "absentphrase"
-- matches none. These densities are explicit choices, not historical claims.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'sln935_scale' THEN
    RAISE EXCEPTION 'Requires the disposable sln935_scale database';
  END IF;
  IF EXISTS (SELECT 1 FROM works) OR EXISTS (SELECT 1 FROM authors) THEN
    RAISE EXCEPTION 'Requires an empty migrated catalogue; existing data is never removed';
  END IF;
END $$;

INSERT INTO authors (id, name, sort_name, slug, bio)
SELECT ('93510000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  CASE WHEN n <= 5000 THEN 'Scale author ' ELSE 'Contributor ' END || lpad(n::text, 5, '0'),
  lpad(n::text, 5, '0') || ', synthetic person', 'sln935-person-' || n,
  'Synthetic person for the SLN-935 index comparison. No source catalogue data.'
FROM generate_series(1, 5503) n;

INSERT INTO works (id, kind, title, slug, catalogue_status, original_language, original_year)
SELECT ('93520000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (CASE WHEN n <= 5000 THEN 'book' ELSE 'painting' END)::work_kind_enum,
  'Scale work ' || lpad(n::text, 5, '0'), 'sln935-work-' || n,
  (CASE WHEN n <= 5000 THEN 'accessioned' ELSE 'tracked' END)::catalogue_status_enum,
  CASE WHEN n <= 5000 THEN 'en' ELSE null END, 1500 + n % 525
FROM generate_series(1, 5006) n;

INSERT INTO work_authors (work_id, author_id, role, sort_order)
SELECT ('93520000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('93510000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'author', 0
FROM generate_series(1, 5000) n;
INSERT INTO work_authors (work_id, author_id, role, sort_order)
SELECT ('93520000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('93510000-0000-4000-8000-' || lpad((1 + n % 5000)::text, 12, '0'))::uuid, 'co_author', 1
FROM generate_series(1, 5000) n WHERE n % 5 = 0;

INSERT INTO editions (id, work_id, title, language, page_count, publication_year)
SELECT ('93530000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('93520000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'Scale edition ' || n, 'en', 200 + n % 400, 1950 + n % 70
FROM generate_series(1, 5000) n;
INSERT INTO edition_contributors (edition_id, author_id, role, sort_order)
SELECT ('93530000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('93510000-0000-4000-8000-' || lpad((1 + (n + 502) % 5503)::text, 12, '0'))::uuid, 'editor', 0
FROM generate_series(1, 5000) n;
INSERT INTO edition_contributors (edition_id, author_id, role, sort_order)
SELECT ('93530000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('93510000-0000-4000-8000-' || lpad((1 + (n + 1003) % 5503)::text, 12, '0'))::uuid, 'translator', 1
FROM generate_series(1, 5000) n WHERE n % 3 = 0;

INSERT INTO tags (id, name, slug)
SELECT ('93540000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Index scale tag ' || n, 'sln935-tag-' || n
FROM generate_series(1, 100) n;
INSERT INTO edition_tags (edition_id, tag_id)
SELECT ('93530000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('93540000-0000-4000-8000-' || lpad((1 + (n + shift) % 100)::text, 12, '0'))::uuid
FROM generate_series(1, 5000) n CROSS JOIN (VALUES (0), (37)) s(shift);

INSERT INTO subjects (id, name, slug)
SELECT ('93550000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Index scale subject ' || n, 'sln935-subject-' || n
FROM generate_series(1, 200) n;
INSERT INTO work_subjects (work_id, subject_id)
SELECT ('93520000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('93550000-0000-4000-8000-' || lpad((1 + (n + shift) % 200)::text, 12, '0'))::uuid
FROM generate_series(1, 5000) n CROSS JOIN (VALUES (0), (37), (83)) s(shift);

INSERT INTO taxonomy_families (id, name, slug, entity_level)
VALUES ('93560000-0000-4000-8000-000000000001', 'Index scale family', 'sln935-family', 'work');
INSERT INTO custom_taxonomy_items (id, family_id, name, slug)
SELECT ('93570000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '93560000-0000-4000-8000-000000000001', 'Index scale item ' || n, 'sln935-item-' || n
FROM generate_series(1, 100) n;
INSERT INTO custom_taxonomy_item_works (item_id, work_id)
SELECT ('93570000-0000-4000-8000-' || lpad((1 + (n + shift) % 100)::text, 12, '0'))::uuid,
  ('93520000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
FROM generate_series(1, 5000) n CROSS JOIN (VALUES (0), (41)) s(shift);

INSERT INTO art_movements (id, name, slug)
SELECT ('93580000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Index scale movement ' || n, 'sln935-movement-' || n
FROM generate_series(1, 3) n;
INSERT INTO work_art_movements (work_id, art_movement_id)
SELECT ('93520000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('93580000-0000-4000-8000-' || lpad((1 + (n + shift) % 3)::text, 12, '0'))::uuid
FROM generate_series(5001, 5006) n CROSS JOIN (VALUES (0), (1)) s(shift);

ANALYZE authors;
ANALYZE works;
ANALYZE editions;
ANALYZE work_authors;
ANALYZE edition_contributors;
ANALYZE edition_tags;
ANALYZE work_subjects;
ANALYZE custom_taxonomy_item_works;
ANALYZE work_art_movements;
COMMIT;

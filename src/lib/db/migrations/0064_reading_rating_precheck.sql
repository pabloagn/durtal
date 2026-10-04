-- SLN-444, before works.rating becomes numeric(2,1) in half steps: every
-- stored rating must already be 1 to 5. A value of 10 or more would overflow
-- numeric(2,1) before any check could name it, so this stops first with a
-- readable list. Never rewrite these silently: ask Joris what they mean.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s %s (rating %s)', id, title, rating), '; ' ORDER BY title, id)
    INTO bad
    FROM works
    WHERE rating IS NOT NULL AND (rating < 1 OR rating > 5);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Ratings outside 1 to 5; ask Joris before migrating: %', bad;
  END IF;
END $$;

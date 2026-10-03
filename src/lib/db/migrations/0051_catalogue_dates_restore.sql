-- pg_restore runs with an empty search_path. catalogue_dates computes its
-- bounds and checks its components while a restore creates and loads it, so
-- the date functions must name catalogue_month_days with its schema; without
-- it, a restore of a backup loses catalogue_dates and every link to it.
-- Bodies are unchanged otherwise, so stored bounds stay valid.
CREATE OR REPLACE FUNCTION catalogue_date_valid(y integer, m integer, d integer) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN y IS NULL THEN m IS NULL AND d IS NULL
   ELSE y BETWEEN -999999 AND 999999 AND y<>0
     AND (m IS NULL OR m BETWEEN 1 AND 12)
     AND (d IS NULL OR (m IS NOT NULL AND d BETWEEN 1 AND public.catalogue_month_days(y,m))) END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION catalogue_date_upper(y integer, m integer, d integer) RETURNS bigint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT y::bigint*10000 + coalesce(m,12)*100 + coalesce(d,public.catalogue_month_days(y,coalesce(m,12)))
$$;

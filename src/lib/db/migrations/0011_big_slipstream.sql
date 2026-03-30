ALTER TABLE "authors" ADD COLUMN "zodiac_sign" text;
--> statement-breakpoint
UPDATE "authors" SET "zodiac_sign" = CASE
  WHEN birth_month = 1  AND birth_day <= 19 THEN 'capricorn'
  WHEN birth_month = 1  AND birth_day >= 20 THEN 'aquarius'
  WHEN birth_month = 2  AND birth_day <= 18 THEN 'aquarius'
  WHEN birth_month = 2  AND birth_day >= 19 THEN 'pisces'
  WHEN birth_month = 3  AND birth_day <= 20 THEN 'pisces'
  WHEN birth_month = 3  AND birth_day >= 21 THEN 'aries'
  WHEN birth_month = 4  AND birth_day <= 19 THEN 'aries'
  WHEN birth_month = 4  AND birth_day >= 20 THEN 'taurus'
  WHEN birth_month = 5  AND birth_day <= 20 THEN 'taurus'
  WHEN birth_month = 5  AND birth_day >= 21 THEN 'gemini'
  WHEN birth_month = 6  AND birth_day <= 20 THEN 'gemini'
  WHEN birth_month = 6  AND birth_day >= 21 THEN 'cancer'
  WHEN birth_month = 7  AND birth_day <= 22 THEN 'cancer'
  WHEN birth_month = 7  AND birth_day >= 23 THEN 'leo'
  WHEN birth_month = 8  AND birth_day <= 22 THEN 'leo'
  WHEN birth_month = 8  AND birth_day >= 23 THEN 'virgo'
  WHEN birth_month = 9  AND birth_day <= 22 THEN 'virgo'
  WHEN birth_month = 9  AND birth_day >= 23 THEN 'libra'
  WHEN birth_month = 10 AND birth_day <= 22 THEN 'libra'
  WHEN birth_month = 10 AND birth_day >= 23 THEN 'scorpio'
  WHEN birth_month = 11 AND birth_day <= 21 THEN 'scorpio'
  WHEN birth_month = 11 AND birth_day >= 22 THEN 'sagittarius'
  WHEN birth_month = 12 AND birth_day <= 21 THEN 'sagittarius'
  WHEN birth_month = 12 AND birth_day >= 22 THEN 'capricorn'
  ELSE NULL
END
WHERE birth_month IS NOT NULL AND birth_day IS NOT NULL;
CREATE TYPE "public"."gender_enum" AS ENUM('male', 'female');--> statement-breakpoint
ALTER TABLE "authors" ALTER COLUMN "gender" SET DATA TYPE "public"."gender_enum" USING lower("gender")::"public"."gender_enum";--> statement-breakpoint
ALTER TABLE "authors" ALTER COLUMN "birth_year_gregorian" SET DATA TYPE smallint USING "birth_year_gregorian"::smallint;--> statement-breakpoint
ALTER TABLE "authors" ALTER COLUMN "death_year_gregorian" SET DATA TYPE smallint USING "death_year_gregorian"::smallint;--> statement-breakpoint
ALTER TABLE "authors" ALTER COLUMN "bio" SET DATA TYPE varchar(10000);--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "nationality_id" uuid;--> statement-breakpoint
ALTER TABLE "authors" ADD CONSTRAINT "authors_nationality_id_countries_id_fk" FOREIGN KEY ("nationality_id") REFERENCES "public"."countries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authors" DROP COLUMN "nationality";
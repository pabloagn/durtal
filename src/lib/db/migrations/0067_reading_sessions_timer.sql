ALTER TABLE "app_settings" ADD COLUMN "reading_day_start_hour" smallint DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "reading_week_start" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "reading_timer_check_minutes" smallint DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "paused_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_reading_day_start_hour_check" CHECK ("app_settings"."reading_day_start_hour" between 0 and 6);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_reading_week_start_check" CHECK ("app_settings"."reading_week_start" in (1, 7));--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_reading_timer_check_minutes_check" CHECK ("app_settings"."reading_timer_check_minutes" between 15 and 480);--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_session_paused_check" CHECK ("reading_sessions"."paused_at" is null or ("reading_sessions"."source" = 'timer' and "reading_sessions"."ended_at" is null));--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_session_paused_seconds_check" CHECK ("reading_sessions"."paused_seconds" between 0 and 86400);
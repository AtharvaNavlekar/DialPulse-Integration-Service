CREATE TABLE "user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"theme" text DEFAULT 'light' NOT NULL,
	"density" text DEFAULT 'comfortable' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"date_format" text DEFAULT 'locale' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_user_preferences_theme" CHECK ("user_preferences"."theme" IN ('light', 'dark')),
	CONSTRAINT "chk_user_preferences_density" CHECK ("user_preferences"."density" IN ('comfortable', 'compact')),
	CONSTRAINT "chk_user_preferences_date_format" CHECK ("user_preferences"."date_format" IN ('locale', 'iso_short', 'day_month_year'))
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_preferences_user_id" ON "user_preferences" USING btree ("user_id");
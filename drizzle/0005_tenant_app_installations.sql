CREATE TABLE "tenant_app_installations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"app_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"enabled_by_uid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_app_installations" ADD CONSTRAINT "tenant_app_installations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenant_app_installations_tenant_app" ON "tenant_app_installations" USING btree ("tenant_id","app_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_app_installations_tenant_enabled" ON "tenant_app_installations" USING btree ("tenant_id","enabled");--> statement-breakpoint
INSERT INTO "tenant_app_installations" ("tenant_id", "app_id", "enabled", "enabled_by_uid")
SELECT
  t."id",
  v."app_id",
  v."enabled",
  'system:migration-0005'
FROM "tenants" t
CROSS JOIN (
  VALUES
    ('forms-studio', true),
    ('workflow-automation', true),
    ('app-management', true)
) AS v("app_id", "enabled")
ON CONFLICT ("tenant_id", "app_id") DO NOTHING;
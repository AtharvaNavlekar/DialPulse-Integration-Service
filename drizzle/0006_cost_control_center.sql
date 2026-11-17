CREATE TABLE "cost_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"budget_id" integer NOT NULL,
	"billing_period" text NOT NULL,
	"alert_level" text NOT NULL,
	"threshold_pct" integer NOT NULL,
	"observed_amount" numeric(14, 4) NOT NULL,
	"budget_amount" numeric(14, 4) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "chk_cost_alerts_level" CHECK ("cost_alerts"."alert_level" IN ('warning', 'critical')),
	CONSTRAINT "chk_cost_alerts_status" CHECK ("cost_alerts"."status" IN ('active', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "cost_budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" text NOT NULL,
	"scope_type" text DEFAULT 'tenant' NOT NULL,
	"scope_value" text,
	"period" text DEFAULT 'monthly' NOT NULL,
	"budget_amount" numeric(14, 4) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"warning_threshold_pct" integer DEFAULT 80 NOT NULL,
	"critical_threshold_pct" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_uid" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_cost_budgets_scope_type" CHECK ("cost_budgets"."scope_type" IN ('tenant', 'category', 'app')),
	CONSTRAINT "chk_cost_budgets_period" CHECK ("cost_budgets"."period" IN ('monthly', 'yearly'))
);
--> statement-breakpoint
CREATE TABLE "cost_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"provider_id" text NOT NULL,
	"provider_name" text NOT NULL,
	"app_id" text,
	"category" text NOT NULL,
	"record_type" text DEFAULT 'actual' NOT NULL,
	"amount" numeric(14, 4) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"usage_quantity" numeric(14, 4),
	"unit" text,
	"unit_price" numeric(14, 6),
	"billing_period" text NOT NULL,
	"reference" text,
	"idempotency_key" text,
	"source_type" text DEFAULT 'manual_entry' NOT NULL,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_uid" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_cost_records_record_type" CHECK ("cost_records"."record_type" IN ('actual', 'imported', 'estimated')),
	CONSTRAINT "chk_cost_records_category" CHECK ("cost_records"."category" IN ('infrastructure', 'ai_models', 'telephony', 'messaging', 'storage', 'software_services', 'other'))
);
--> statement-breakpoint
CREATE TABLE "provider_pricing_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"provider_id" text NOT NULL,
	"service_name" text NOT NULL,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"unit_price" numeric(14, 6) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"effective_date" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by_uid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_alerts" ADD CONSTRAINT "cost_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_alerts" ADD CONSTRAINT "cost_alerts_budget_id_cost_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."cost_budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_budgets" ADD CONSTRAINT "cost_budgets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_pricing_configs" ADD CONSTRAINT "provider_pricing_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cost_alerts_budget_period_level" ON "cost_alerts" USING btree ("tenant_id","budget_id","billing_period","alert_level");--> statement-breakpoint
CREATE INDEX "idx_cost_alerts_tenant_status" ON "cost_alerts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_cost_budgets_tenant_enabled" ON "cost_budgets" USING btree ("tenant_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cost_records_tenant_idempotency" ON "cost_records" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_cost_records_tenant_period" ON "cost_records" USING btree ("tenant_id","billing_period");--> statement-breakpoint
CREATE INDEX "idx_cost_records_tenant_category" ON "cost_records" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "idx_cost_records_tenant_type" ON "cost_records" USING btree ("tenant_id","record_type");--> statement-breakpoint
CREATE INDEX "idx_cost_records_tenant_recorded" ON "cost_records" USING btree ("tenant_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_provider_pricing_tenant_service_eff" ON "provider_pricing_configs" USING btree ("tenant_id","provider_id","service_name","effective_date");--> statement-breakpoint
CREATE INDEX "idx_provider_pricing_tenant_provider" ON "provider_pricing_configs" USING btree ("tenant_id","provider_id");--> statement-breakpoint
INSERT INTO "tenant_app_installations" ("tenant_id", "app_id", "enabled", "enabled_by_uid")
SELECT
  t."id",
  'cost-control-center',
  true,
  'system:migration-0006'
FROM "tenants" t
ON CONFLICT ("tenant_id", "app_id") DO NOTHING;
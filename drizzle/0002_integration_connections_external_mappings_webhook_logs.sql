CREATE TABLE "event_replay_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"source" text NOT NULL,
	"target_row_id" integer NOT NULL,
	"event_id" text NOT NULL,
	"consumer_name" text,
	"replayed_by_uid" text NOT NULL,
	"replayed_by_label" text NOT NULL,
	"reason" text NOT NULL,
	"previous_status" text NOT NULL,
	"previous_attempts" integer NOT NULL,
	"previous_last_error" text,
	"replayed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_id_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"connection_id" integer NOT NULL,
	"provider_id" text NOT NULL,
	"internal_entity_type" text NOT NULL,
	"internal_entity_id" text NOT NULL,
	"external_entity_type" text NOT NULL,
	"external_entity_id" text NOT NULL,
	"mapping_status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"provider_id" text NOT NULL,
	"connection_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"auth_mode" text NOT NULL,
	"secret_ref" jsonb NOT NULL,
	"allowed_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"environment" text DEFAULT 'development' NOT NULL,
	"approved_by_uid" text,
	"approved_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_webhook_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"connection_id" integer NOT NULL,
	"provider_id" text NOT NULL,
	"provider_event_id" text,
	"event_type" text,
	"payload_sha256" text NOT NULL,
	"verification_outcome" text NOT NULL,
	"processing_status" text NOT NULL,
	"http_status" integer NOT NULL,
	"sanitized_failure_reason" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "event_inbox" ADD COLUMN "replay_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_inbox" ADD COLUMN "last_replayed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_inbox" ADD COLUMN "last_replayed_by_uid" text;--> statement-breakpoint
ALTER TABLE "event_inbox" ADD COLUMN "last_replay_reason" text;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD COLUMN "replay_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD COLUMN "last_replayed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD COLUMN "last_replayed_by_uid" text;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD COLUMN "last_replay_reason" text;--> statement-breakpoint
ALTER TABLE "event_replay_logs" ADD CONSTRAINT "event_replay_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_id_mappings" ADD CONSTRAINT "external_id_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_id_mappings" ADD CONSTRAINT "external_id_mappings_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_webhook_logs" ADD CONSTRAINT "provider_webhook_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_webhook_logs" ADD CONSTRAINT "provider_webhook_logs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_event_replay_logs_tenant_at" ON "event_replay_logs" USING btree ("tenant_id","replayed_at");--> statement-breakpoint
CREATE INDEX "idx_event_replay_logs_source_row" ON "event_replay_logs" USING btree ("source","target_row_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ext_map_internal" ON "external_id_mappings" USING btree ("tenant_id","connection_id","internal_entity_type","internal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ext_map_external" ON "external_id_mappings" USING btree ("tenant_id","connection_id","external_entity_type","external_entity_id");--> statement-breakpoint
CREATE INDEX "idx_ext_map_tenant_provider" ON "external_id_mappings" USING btree ("tenant_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_integration_conn_tenant_provider_name" ON "integration_connections" USING btree ("tenant_id","provider_id","connection_name");--> statement-breakpoint
CREATE INDEX "idx_integration_conn_tenant_status" ON "integration_connections" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_integration_conn_provider_status" ON "integration_connections" USING btree ("provider_id","status");--> statement-breakpoint
CREATE INDEX "idx_webhook_logs_tenant_received" ON "provider_webhook_logs" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_logs_conn_received" ON "provider_webhook_logs" USING btree ("connection_id","received_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_logs_provider_event" ON "provider_webhook_logs" USING btree ("provider_id","provider_event_id");
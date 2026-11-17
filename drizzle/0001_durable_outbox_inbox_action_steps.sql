CREATE TABLE "automation_action_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"automation_execution_id" integer NOT NULL,
	"event_id" text NOT NULL,
	"action_key" text NOT NULL,
	"action_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result_metadata" jsonb,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_inbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"consumer_name" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"lock_owner" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"event_id" text NOT NULL,
	"schema_version" text DEFAULT '1.0' NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"lock_owner" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "internal_notifications" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "lead_intake_records" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "automation_action_steps" ADD CONSTRAINT "automation_action_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_action_steps" ADD CONSTRAINT "automation_action_steps_automation_execution_id_automation_executions_id_fk" FOREIGN KEY ("automation_execution_id") REFERENCES "public"."automation_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_inbox" ADD CONSTRAINT "event_inbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_automation_action_steps_exec_key" ON "automation_action_steps" USING btree ("automation_execution_id","action_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_automation_action_steps_idempotency" ON "automation_action_steps" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_automation_action_steps_tenant_status" ON "automation_action_steps" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_event_inbox_tenant_consumer_event" ON "event_inbox" USING btree ("tenant_id","consumer_name","event_id");--> statement-breakpoint
CREATE INDEX "idx_event_inbox_pending_poll" ON "event_inbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "idx_event_inbox_lease_recovery" ON "event_inbox" USING btree ("status","locked_at");--> statement-breakpoint
CREATE INDEX "idx_event_inbox_tenant_status" ON "event_inbox" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_event_outbox_event_id" ON "event_outbox" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_event_outbox_pending_poll" ON "event_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "idx_event_outbox_lease_recovery" ON "event_outbox" USING btree ("status","locked_at");--> statement-breakpoint
CREATE INDEX "idx_event_outbox_tenant_status" ON "event_outbox" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_activity_logs_tenant_idempotency" ON "activity_logs" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_follow_up_tasks_tenant_idempotency" ON "follow_up_tasks" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_internal_notifications_tenant_idempotency" ON "internal_notifications" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lead_intake_tenant_idempotency" ON "lead_intake_records" USING btree ("tenant_id","idempotency_key");
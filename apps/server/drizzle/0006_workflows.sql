CREATE TABLE "workflow" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"module_id" text,
	"module_key" text,
	"trigger" jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cursor" bigint,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"status" text NOT NULL,
	"trigger" jsonb NOT NULL,
	"context" jsonb,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"wake_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"stalls" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"record_id" text,
	"object_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_ws_idx" ON "workflow" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_module_key_idx" ON "workflow" USING btree ("workspace_id","module_id","module_key") WHERE "workflow"."module_id" is not null;--> statement-breakpoint
CREATE INDEX "workflow_run_ws_workflow_idx" ON "workflow_run" USING btree ("workspace_id","workflow_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_key_idx" ON "workflow_run" USING btree ("workflow_id","idempotency_key") WHERE "workflow_run"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "workflow_run_record_idx" ON "workflow_run" USING btree ("workspace_id","record_id","id" DESC NULLS LAST) WHERE "workflow_run"."record_id" is not null;--> statement-breakpoint
CREATE INDEX "workflow_run_object_idx" ON "workflow_run" USING btree ("workspace_id","object_id","id" DESC NULLS LAST) WHERE "workflow_run"."object_id" is not null;--> statement-breakpoint
CREATE INDEX "workflow_run_open_idx" ON "workflow_run" USING btree ("workspace_id","wake_at") WHERE "workflow_run"."status" in ('pending', 'running');
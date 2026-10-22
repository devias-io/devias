CREATE TABLE "job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"module_id" text NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb,
	"result" jsonb,
	"idempotency_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"schedule" text,
	"connection_id" text,
	"on_behalf_of" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "job_idempotency_uq" UNIQUE("workspace_id","module_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "module_kv" (
	"workspace_id" text NOT NULL,
	"module_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_kv_workspace_id_module_id_key_pk" PRIMARY KEY("workspace_id","module_id","key")
);
--> statement-breakpoint
CREATE INDEX "job_due_idx" ON "job" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "job_ws_module_idx" ON "job" USING btree ("workspace_id","module_id","id" DESC NULLS LAST);
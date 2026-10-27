CREATE TABLE "ai_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"requested_by" text NOT NULL,
	"summary" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "ai_run_task_idx" ON "ai_run" USING btree ("workspace_id","task_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_run_open_idx" ON "ai_run" USING btree ("workspace_id","status");
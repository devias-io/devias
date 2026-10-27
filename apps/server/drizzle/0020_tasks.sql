CREATE TABLE "task" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"description" jsonb NOT NULL,
	"description_text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"priority" text DEFAULT 'none' NOT NULL,
	"priority_rank" integer DEFAULT 4 NOT NULL,
	"assignee_kind" text,
	"assignee_id" text,
	"assigned_by" jsonb,
	"due_date" date,
	"parent_id" uuid,
	"depth" integer DEFAULT 0 NOT NULL,
	"root_id" uuid,
	"work" text,
	"run_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"queued_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" jsonb NOT NULL,
	"updated_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "task_status_check" CHECK ("task"."status" in ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled')),
	CONSTRAINT "task_priority_check" CHECK ("task"."priority" in ('urgent', 'high', 'medium', 'low', 'none')),
	CONSTRAINT "task_work_check" CHECK ("task"."work" is null or "task"."work" in ('working', 'waiting_on_you', 'waiting_on_subtasks', 'failed')),
	CONSTRAINT "task_assignee_check" CHECK (("task"."assignee_kind" is null and "task"."assignee_id" is null) or ("task"."assignee_kind" in ('user', 'agent') and "task"."assignee_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_parent_id_task_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_ws_key_idx" ON "task" USING btree ("workspace_id","key") WHERE "task"."key" is not null;--> statement-breakpoint
CREATE INDEX "task_ws_updated_idx" ON "task" USING btree ("workspace_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "task"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "task_ws_status_idx" ON "task" USING btree ("workspace_id","status","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "task"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "task_assignee_idx" ON "task" USING btree ("workspace_id","assignee_kind","assignee_id","status") WHERE "task"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "task_due_idx" ON "task" USING btree ("workspace_id","due_date") WHERE "task"."deleted_at" is null and "task"."due_date" is not null;--> statement-breakpoint
CREATE INDEX "task_queue_idx" ON "task" USING btree ("workspace_id","assignee_id","priority_rank","due_date","created_at") WHERE "task"."deleted_at" is null and "task"."status" = 'todo' and "task"."assignee_kind" = 'agent' and "task"."work" is null;--> statement-breakpoint
CREATE INDEX "task_parent_idx" ON "task" USING btree ("parent_id") WHERE "task"."deleted_at" is null;
CREATE TABLE "ai_agent" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"description" text,
	"instructions" text,
	"tools" jsonb,
	"starter_prompts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approval_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"takes_tasks" boolean DEFAULT false NOT NULL,
	"module_id" text,
	"archived_at" timestamp with time zone,
	"archived_by_module" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE INDEX "ai_agent_ws_idx" ON "ai_agent" USING btree ("workspace_id","name");
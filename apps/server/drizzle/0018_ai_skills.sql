CREATE TABLE "ai_skill" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"body" text NOT NULL,
	"module_id" text,
	"archived_at" timestamp with time zone,
	"archived_by_module" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_skill_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "skills" jsonb;--> statement-breakpoint
CREATE INDEX "ai_skill_ws_idx" ON "ai_skill" USING btree ("workspace_id","label");
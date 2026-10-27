CREATE TABLE "ai_settings" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"default_agent_id" text,
	"seeded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

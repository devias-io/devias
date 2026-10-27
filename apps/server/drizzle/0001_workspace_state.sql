CREATE TABLE "workspace_state" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"event_seq" bigint DEFAULT 0 NOT NULL,
	"metadata_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

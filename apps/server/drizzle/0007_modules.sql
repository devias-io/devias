CREATE TABLE "module" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"version" text NOT NULL,
	"manifest_hash" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"installed_by" text NOT NULL,
	CONSTRAINT "module_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
CREATE TABLE "module" (
	"workspace_id" text NOT NULL,
	"module_id" text NOT NULL,
	"version" text NOT NULL,
	"manifest_hash" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"installed_by" text NOT NULL,
	CONSTRAINT "module_workspace_id_module_id_pk" PRIMARY KEY("workspace_id","module_id")
);
--> statement-breakpoint
CREATE TABLE "module_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"module_id" text NOT NULL,
	"type" text NOT NULL,
	"external_id" text,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_event_ws_module_external_uq" UNIQUE("workspace_id","module_id","external_id")
);
--> statement-breakpoint
CREATE INDEX "module_event_ws_module_idx" ON "module_event" USING btree ("workspace_id","module_id","id" DESC NULLS LAST);
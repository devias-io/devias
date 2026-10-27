CREATE TABLE "event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"type" text NOT NULL,
	"object_id" text,
	"object_name" text,
	"record_id" uuid,
	"actor" jsonb NOT NULL,
	"changed_fields" jsonb,
	"diff" jsonb,
	"metadata_version" integer,
	"module_id" text,
	"entity" text,
	"entity_id" text,
	"version" text,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_workspace_id_sequence_unique" UNIQUE("workspace_id","sequence")
);
--> statement-breakpoint
CREATE INDEX "event_ws_record_idx" ON "event" USING btree ("workspace_id","record_id","sequence");--> statement-breakpoint
CREATE INDEX "event_ws_entity_idx" ON "event" USING btree ("workspace_id","entity","entity_id","sequence");
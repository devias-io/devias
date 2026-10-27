CREATE TABLE "webhook_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"module_id" text NOT NULL,
	"type" text NOT NULL,
	"external_id" text,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_event_ws_module_external_uq" UNIQUE("workspace_id","module_id","external_id")
);--> statement-breakpoint
CREATE INDEX "webhook_event_ws_module_idx" ON "webhook_event" USING btree ("workspace_id","module_id","id" DESC NULLS LAST);
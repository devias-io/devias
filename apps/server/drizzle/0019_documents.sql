CREATE TABLE "document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"preview" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" jsonb NOT NULL,
	"updated_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "document_ws_updated_idx" ON "document" USING btree ("workspace_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "document"."deleted_at" is null;
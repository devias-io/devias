CREATE TABLE "comment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"object_id" text,
	"actor" jsonb NOT NULL,
	"parent_id" uuid,
	"anchor" jsonb,
	"resolved_at" timestamp with time zone,
	"resolved_by" jsonb,
	"title" text,
	"body" text DEFAULT '' NOT NULL,
	"cause" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "comment_entity_kind_check" CHECK ("comment"."entity_kind" in ('task', 'document', 'record'))
);
--> statement-breakpoint
CREATE INDEX "comment_entity_idx" ON "comment" USING btree ("workspace_id","entity_kind","entity_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "comment"."deleted_at" is null;
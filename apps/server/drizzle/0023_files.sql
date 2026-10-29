CREATE TABLE "file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"kind" text DEFAULT 'asset' NOT NULL,
	"public" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"checksum" text NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer,
	"height" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" jsonb NOT NULL,
	"updated_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "file_kind_check" CHECK ("file"."kind" in ('asset', 'logo', 'avatar')),
	CONSTRAINT "file_owner_check" CHECK ("file"."workspace_id" is not null or ("file"."kind" = 'avatar' and "file"."created_by"->>'kind' = 'user'))
);
--> statement-breakpoint
CREATE INDEX "file_library_idx" ON "file" USING btree ("workspace_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "file"."deleted_at" is null and "file"."kind" = 'asset';--> statement-breakpoint
CREATE INDEX "file_ws_checksum_idx" ON "file" USING btree ("workspace_id","checksum");
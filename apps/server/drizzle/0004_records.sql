CREATE TABLE "record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"object_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "record_unique" (
	"workspace_id" text NOT NULL,
	"object_id" text NOT NULL,
	"field_id" text NOT NULL,
	"value" text NOT NULL,
	"record_id" uuid NOT NULL,
	CONSTRAINT "record_unique_workspace_id_object_id_field_id_value_pk" PRIMARY KEY("workspace_id","object_id","field_id","value")
);
--> statement-breakpoint
ALTER TABLE "record" ADD CONSTRAINT "record_workspace_id_object_id_object_metadata_workspace_id_id_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."object_metadata"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_ws_object_updated_idx" ON "record" USING btree ("workspace_id","object_id","updated_at" DESC NULLS LAST,"id") WHERE "record"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "record_data_gin_idx" ON "record" USING gin ("data");
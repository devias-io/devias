CREATE TABLE "field_metadata" (
	"workspace_id" text NOT NULL,
	"object_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"icon" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_unique" boolean DEFAULT false NOT NULL,
	"default_value" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"module_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_metadata_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "field_metadata_object_name_uq" UNIQUE("workspace_id","object_id","name")
);
--> statement-breakpoint
CREATE TABLE "object_metadata" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"name_singular" text NOT NULL,
	"name_plural" text NOT NULL,
	"label_singular" text NOT NULL,
	"label_plural" text NOT NULL,
	"icon" text,
	"description" text,
	"primary_field_id" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"read_only" boolean DEFAULT false NOT NULL,
	"delete_when" jsonb,
	"module_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_metadata_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "object_metadata_ws_name_singular_uq" UNIQUE("workspace_id","name_singular")
);
--> statement-breakpoint
CREATE TABLE "object_permission" (
	"workspace_id" text NOT NULL,
	"object_id" text NOT NULL,
	"role" text NOT NULL,
	"can_read" boolean DEFAULT true NOT NULL,
	"can_write" boolean DEFAULT true NOT NULL,
	CONSTRAINT "object_permission_workspace_id_object_id_role_pk" PRIMARY KEY("workspace_id","object_id","role")
);
--> statement-breakpoint
ALTER TABLE "field_metadata" ADD CONSTRAINT "field_metadata_workspace_id_object_id_object_metadata_workspace_id_id_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."object_metadata"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_permission" ADD CONSTRAINT "object_permission_workspace_id_object_id_object_metadata_workspace_id_id_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."object_metadata"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_metadata_ws_idx" ON "field_metadata" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "object_metadata_ws_idx" ON "object_metadata" USING btree ("workspace_id");
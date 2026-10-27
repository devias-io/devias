CREATE TABLE "command_item" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"label" text NOT NULL,
	"icon" text,
	"group_name" text,
	"shortcut" text,
	"action" jsonb NOT NULL,
	"module_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_item_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "layout" (
	"workspace_id" text NOT NULL,
	"object_id" text NOT NULL,
	"id" text NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'record' NOT NULL,
	"shell" text DEFAULT 'tabs' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"module_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layout_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "nav_item" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"label" text NOT NULL,
	"icon" text,
	"target" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"parent_id" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"overrides" jsonb,
	"module_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nav_item_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "view" (
	"workspace_id" text NOT NULL,
	"object_id" text NOT NULL,
	"id" text NOT NULL,
	"label" text NOT NULL,
	"type" text DEFAULT 'table' NOT NULL,
	"icon" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"module_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "view_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "layout" ADD CONSTRAINT "layout_workspace_id_object_id_object_metadata_workspace_id_id_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."object_metadata"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view" ADD CONSTRAINT "view_workspace_id_object_id_object_metadata_workspace_id_id_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."object_metadata"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "command_item_ws_idx" ON "command_item" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "layout_ws_idx" ON "layout" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "nav_item_ws_idx" ON "nav_item" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "view_ws_idx" ON "view" USING btree ("workspace_id");
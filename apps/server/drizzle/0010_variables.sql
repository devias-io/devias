CREATE TABLE "variable" (
	"workspace_id" text NOT NULL,
	"module_id" text NOT NULL,
	"id" text NOT NULL,
	"value" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variable_workspace_id_module_id_id_pk" PRIMARY KEY("workspace_id","module_id","id")
);
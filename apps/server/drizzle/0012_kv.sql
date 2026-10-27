CREATE TABLE "kv" (
	"workspace_id" text NOT NULL,
	"module_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kv_workspace_id_module_id_key_pk" PRIMARY KEY("workspace_id","module_id","key")
);
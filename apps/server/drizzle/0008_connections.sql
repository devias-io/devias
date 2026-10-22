CREATE TABLE "module_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"module_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"kind" text NOT NULL,
	"visibility" text NOT NULL,
	"owner_user_id" text,
	"label" text,
	"account" text,
	"sealed" text NOT NULL,
	"hints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'connected' NOT NULL,
	"auth_failed_at" timestamp with time zone,
	"last_error" text,
	"last_tested_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"webhook_token" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_connection_owner_account_uq" UNIQUE NULLS NOT DISTINCT("workspace_id","module_id","provider_id","owner_user_id","account"),
	CONSTRAINT "module_connection_webhook_token_uq" UNIQUE("webhook_token")
);
--> statement-breakpoint
CREATE TABLE "module_variable" (
	"workspace_id" text NOT NULL,
	"module_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_variable_workspace_id_module_id_key_pk" PRIMARY KEY("workspace_id","module_id","key")
);
--> statement-breakpoint
CREATE TABLE "oauth_state" (
	"state" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"module_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"visibility" text NOT NULL,
	"code_verifier" text,
	"return_to" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "module_connection_ws_module_idx" ON "module_connection" USING btree ("workspace_id","module_id");--> statement-breakpoint
CREATE INDEX "oauth_state_expires_idx" ON "oauth_state" USING btree ("expires_at");
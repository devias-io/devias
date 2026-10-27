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
);--> statement-breakpoint
CREATE INDEX "oauth_state_expires_idx" ON "oauth_state" USING btree ("expires_at");
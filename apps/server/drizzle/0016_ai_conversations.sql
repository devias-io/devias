CREATE TABLE "ai_conversation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"title" text,
	"run_id" uuid,
	"active_turn_id" uuid,
	"usage" jsonb DEFAULT '{"inputTokens":0,"outputTokens":0,"cacheReadInputTokens":0,"cacheCreationInputTokens":0}'::jsonb NOT NULL,
	"schema_version_seen" integer,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"content" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"text" text,
	"context" jsonb,
	"model" text,
	"usage" jsonb,
	"stop_reason" text,
	"partial" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_message_conversation_seq_uq" UNIQUE("conversation_id","seq")
);
--> statement-breakpoint
CREATE TABLE "ai_tool_call" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"tool_use_id" text NOT NULL,
	"name" text NOT NULL,
	"input" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"is_error" boolean DEFAULT false NOT NULL,
	"reason" text,
	"input_request" jsonb,
	"resolved_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_tool_call_conversation_tool_use_uq" UNIQUE("conversation_id","tool_use_id")
);
--> statement-breakpoint
CREATE TABLE "ai_turn" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"iteration" integer DEFAULT 0 NOT NULL,
	"usage" jsonb DEFAULT '{"inputTokens":0,"outputTokens":0,"cacheReadInputTokens":0,"cacheCreationInputTokens":0}'::jsonb NOT NULL,
	"error" jsonb,
	"stop_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_conversation" ADD CONSTRAINT "ai_conversation_workspace_id_agent_id_ai_agent_workspace_id_id_fk" FOREIGN KEY ("workspace_id","agent_id") REFERENCES "public"."ai_agent"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_conversation_id_ai_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_call" ADD CONSTRAINT "ai_tool_call_conversation_id_ai_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_turn" ADD CONSTRAINT "ai_turn_conversation_id_ai_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversation_ws_user_idx" ON "ai_conversation" USING btree ("workspace_id","user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_tool_call_turn_status_idx" ON "ai_tool_call" USING btree ("turn_id","status");--> statement-breakpoint
CREATE INDEX "ai_tool_call_message_idx" ON "ai_tool_call" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "ai_turn_conversation_idx" ON "ai_turn" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ai_turn_status_idx" ON "ai_turn" USING btree ("status");
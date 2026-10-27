CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"kind" text NOT NULL,
	"level" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"target" jsonb,
	"key" text,
	"data" jsonb,
	"actor" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notification_ws_recipient_created_idx" ON "notification" USING btree ("workspace_id","recipient_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "notification_ws_recipient_unread_idx" ON "notification" USING btree ("workspace_id","recipient_id") WHERE "notification"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notification_ws_recipient_key_idx" ON "notification" USING btree ("workspace_id","recipient_id","key") WHERE "notification"."key" is not null;
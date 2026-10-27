CREATE TABLE "mention" (
	"workspace_id" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"object_id" text DEFAULT '' NOT NULL,
	"target_id" uuid NOT NULL,
	"role" text DEFAULT 'mention' NOT NULL,
	CONSTRAINT "mention_entity_kind_entity_id_kind_object_id_target_id_role_pk" PRIMARY KEY("entity_kind","entity_id","kind","object_id","target_id","role"),
	CONSTRAINT "mention_entity_kind_check" CHECK ("mention"."entity_kind" in ('task', 'document')),
	CONSTRAINT "mention_kind_check" CHECK ("mention"."kind" in ('record', 'document', 'task')),
	CONSTRAINT "mention_role_check" CHECK ("mention"."role" in ('mention', 'about'))
);
--> statement-breakpoint
CREATE INDEX "mention_target_idx" ON "mention" USING btree ("workspace_id","kind","object_id","target_id");
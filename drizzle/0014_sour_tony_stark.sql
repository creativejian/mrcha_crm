CREATE TABLE "crm"."assistant_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"sources" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_messages_role_check" CHECK ("crm"."assistant_messages"."role" IS NULL OR "crm"."assistant_messages"."role" IN ('user', 'assistant'))
);
CREATE INDEX IF NOT EXISTS "assistant_messages_staff_created_idx" ON "crm"."assistant_messages" ("staff_user_id", "created_at");

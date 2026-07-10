CREATE TABLE "crm"."customer_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_code" text NOT NULL,
	"name" text NOT NULL,
	"app_user_id" uuid,
	"quote_count" integer DEFAULT 0 NOT NULL,
	"deleted_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);

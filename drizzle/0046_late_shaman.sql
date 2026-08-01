CREATE TABLE "crm"."account_deletion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_user_id" uuid,
	"customer_id" uuid,
	"customer_code" text,
	"proposed_classification" text NOT NULL,
	"confirmed_classification" text,
	"status" text DEFAULT 'received' NOT NULL,
	"executed_via" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	CONSTRAINT "account_deletion_jobs_app_user_id_unique" UNIQUE("app_user_id"),
	CONSTRAINT "account_deletion_jobs_proposed_check" CHECK ("crm"."account_deletion_jobs"."proposed_classification" IS NULL OR "crm"."account_deletion_jobs"."proposed_classification" IN ('purge', 'active_fulfillment', 'settlement_reference')),
	CONSTRAINT "account_deletion_jobs_confirmed_check" CHECK ("crm"."account_deletion_jobs"."confirmed_classification" IS NULL OR "crm"."account_deletion_jobs"."confirmed_classification" IN ('purge', 'active_fulfillment', 'settlement_reference')),
	CONSTRAINT "account_deletion_jobs_status_check" CHECK ("crm"."account_deletion_jobs"."status" IS NULL OR "crm"."account_deletion_jobs"."status" IN ('received', 'executed')),
	CONSTRAINT "account_deletion_jobs_executed_via_check" CHECK ("crm"."account_deletion_jobs"."executed_via" IS NULL OR "crm"."account_deletion_jobs"."executed_via" IN ('confirm', 'auto'))
);
--> statement-breakpoint
CREATE TABLE "crm"."settlement_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lender" text,
	"product" text,
	"settlement_no" text,
	"contract_ref" text,
	"amount" numeric,
	"expected_date" date,
	"settled_date" date,
	"status" text DEFAULT 'review_required' NOT NULL,
	"clawback_until" date,
	"deletion_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_references_status_check" CHECK ("crm"."settlement_references"."status" IS NULL OR "crm"."settlement_references"."status" IN ('pending', 'settled', 'review_required', 'legal_hold'))
);
--> statement-breakpoint
ALTER TABLE "crm"."customer_deletions" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD COLUMN "retention_basis" text;--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD COLUMN "retention_until" timestamp with time zone;
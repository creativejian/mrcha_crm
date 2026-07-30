CREATE TABLE "crm"."catalog_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" bigint,
	"payload" jsonb NOT NULL,
	"snapshot" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"reject_reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_change_requests_kind_check" CHECK ("crm"."catalog_change_requests"."kind" in ('model.create','model.update','trim.create','trim.update','option.create','option.update','trim.no-option.set','trim.no-option.unset')),
	CONSTRAINT "catalog_change_requests_target_type_check" CHECK ("crm"."catalog_change_requests"."target_type" in ('model','trim','option')),
	CONSTRAINT "catalog_change_requests_status_check" CHECK ("crm"."catalog_change_requests"."status" in ('pending','approved','rejected','canceled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_change_requests_pending_target_unique" ON "crm"."catalog_change_requests" USING btree ("target_type","target_id","kind") WHERE "crm"."catalog_change_requests"."status" = 'pending' and "crm"."catalog_change_requests"."target_id" is not null;
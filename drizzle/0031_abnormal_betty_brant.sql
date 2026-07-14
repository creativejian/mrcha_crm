ALTER TABLE "crm"."quote_scenarios" ADD COLUMN "solution_lender_code" text;--> statement-breakpoint
ALTER TABLE "crm"."quote_scenarios" ADD COLUMN "solution_workbook_version" text;--> statement-breakpoint
ALTER TABLE "crm"."quote_scenarios" ADD COLUMN "solution_calculated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm"."quote_scenarios" ADD COLUMN "solution_raw" jsonb;
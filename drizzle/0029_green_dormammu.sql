ALTER TABLE "crm"."customers" ADD COLUMN "manage_status" text;--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD COLUMN "manage_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD CONSTRAINT "customers_manage_status_check" CHECK ("crm"."customers"."manage_status" IS NULL OR "crm"."customers"."manage_status" IN ('정상', '확인필요', '재문의', '지연', '장기방치'));
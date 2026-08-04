ALTER TABLE "crm"."assistant_messages" ADD COLUMN "turn_id" uuid;--> statement-breakpoint
ALTER TABLE "crm"."assistant_messages" ADD COLUMN "subject_customer_ids" uuid[];--> statement-breakpoint
CREATE INDEX "assistant_messages_subject_customer_ids_idx" ON "crm"."assistant_messages" USING gin ("subject_customer_ids");
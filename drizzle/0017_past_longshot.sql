CREATE INDEX "customer_documents_customer_id_created_at_idx" ON "crm"."customer_documents" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_memos_customer_id_created_at_idx" ON "crm"."customer_memos" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_schedules_customer_id_created_at_idx" ON "crm"."customer_schedules" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_tasks_customer_id_created_at_idx" ON "crm"."customer_tasks" USING btree ("customer_id","created_at");--> statement-breakpoint
ALTER TABLE "crm"."customers" DROP COLUMN "last_activity_at";
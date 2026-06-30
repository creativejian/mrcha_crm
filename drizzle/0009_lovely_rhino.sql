ALTER TABLE "crm"."customers" ADD COLUMN "need_contract_term" text;--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD COLUMN "need_initial_cost" text;--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD COLUMN "need_annual_mileage" text;--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD COLUMN "need_delivery_method" text;--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD COLUMN "need_contract_focus" text;--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD COLUMN "need_customer_note" text;--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD COLUMN "need_review_note" text;--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD CONSTRAINT "customers_need_contract_term_check" CHECK ("crm"."customers"."need_contract_term" IS NULL OR "crm"."customers"."need_contract_term" IN ('12개월', '24개월', '36개월', '48개월', '60개월', '확인 필요'));--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD CONSTRAINT "customers_need_annual_mileage_check" CHECK ("crm"."customers"."need_annual_mileage" IS NULL OR "crm"."customers"."need_annual_mileage" IN ('10,000km', '15,000km', '20,000km', '25,000km', '30,000km', '35,000km', '40,000km', '무제한', '확인 필요'));--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD CONSTRAINT "customers_need_delivery_method_check" CHECK ("crm"."customers"."need_delivery_method" IS NULL OR "crm"."customers"."need_delivery_method" IN ('탁송 요청', '매장 출고', '직접 수령', '협의 필요', '확인 필요'));
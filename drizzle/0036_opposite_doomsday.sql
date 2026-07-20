CREATE TABLE "crm"."customer_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"contract_vehicle" text,
	"contract_date" date,
	"lender" text,
	"delivered_date" date,
	"delivery_memo" text,
	"source_quote_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_deliveries_customer_id_unique" UNIQUE("customer_id")
);
--> statement-breakpoint
ALTER TABLE "crm"."customer_deliveries" ADD CONSTRAINT "customer_deliveries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."customer_deliveries" ADD CONSTRAINT "customer_deliveries_source_quote_id_quotes_id_fk" FOREIGN KEY ("source_quote_id") REFERENCES "crm"."quotes"("id") ON DELETE set null ON UPDATE no action;
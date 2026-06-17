CREATE SCHEMA "crm";
--> statement-breakpoint
CREATE TABLE "crm"."consultations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel" text,
	"summary" text,
	"status" text,
	"occurred_at" timestamp with time zone,
	"advisor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."customer_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"title" text,
	"doc_type" text,
	"file_name" text,
	"file_size" integer,
	"file_mime" text,
	"file_path" text,
	"sort_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."customer_memos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."customer_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"scheduled_date" date,
	"scheduled_time" text,
	"type" text,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."customer_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"category" text,
	"due" text,
	"body" text,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_code" text NOT NULL,
	"app_user_id" uuid,
	"name" text NOT NULL,
	"phone" text,
	"residence" text,
	"customer_type" text,
	"customer_type_detail" text,
	"status_group" text,
	"status" text,
	"priority" text,
	"chance" text,
	"advisor_id" uuid,
	"team" text,
	"assigned_at" timestamp with time zone,
	"source" text,
	"source_consultation_id" uuid,
	"received_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"recontacted" boolean DEFAULT false NOT NULL,
	"ai_summary" text,
	"need_model" text,
	"need_trim" text,
	"need_method" text,
	"need_timing" text,
	"need_colors" text,
	"need_compare" text,
	"need_memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_customer_code_unique" UNIQUE("customer_code")
);
--> statement-breakpoint
CREATE TABLE "crm"."quote_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"scenario_no" smallint,
	"is_saved" boolean DEFAULT false NOT NULL,
	"saved_at" timestamp with time zone,
	"purchase_method" text,
	"lender" text,
	"term_months" smallint,
	"deposit_mode" text,
	"deposit_value" numeric,
	"down_payment_mode" text,
	"down_payment_value" numeric,
	"residual_mode" text,
	"residual_value" numeric,
	"mileage_mode" text,
	"mileage_value" text,
	"car_tax_included" boolean,
	"subsidy_applicable" boolean,
	"subsidy_amount" numeric,
	"monthly_payment" numeric,
	"total_return_cost" numeric,
	"total_takeover_cost" numeric,
	"due_at_delivery" numeric,
	"interest_rate" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_code" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"entry_mode" text,
	"quote_round" text,
	"source_quote_request_id" uuid,
	"source_ai_estimate_id" uuid,
	"trim_id" bigint,
	"brand_name" text,
	"model_name" text,
	"trim_name" text,
	"base_price" numeric,
	"exterior_color_id" bigint,
	"exterior_color_name" text,
	"exterior_color_hex" text,
	"interior_color_id" bigint,
	"interior_color_name" text,
	"interior_color_hex" text,
	"options" jsonb,
	"option_total" numeric,
	"discount_lines" jsonb,
	"final_discount" numeric,
	"acquisition_tax" numeric,
	"acquisition_tax_mode" text,
	"bond" numeric,
	"delivery" numeric,
	"incidental" numeric,
	"final_vehicle_price" numeric,
	"acquisition_cost" numeric,
	"status" text,
	"app_status" text,
	"decision_status" text,
	"stock_status" text,
	"valid_until" timestamp with time zone,
	"note" text,
	"primary_scenario_id" uuid,
	"file_name" text,
	"file_size" integer,
	"file_mime" text,
	"file_path" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_quote_code_unique" UNIQUE("quote_code")
);
--> statement-breakpoint
ALTER TABLE "crm"."consultations" ADD CONSTRAINT "consultations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."customer_documents" ADD CONSTRAINT "customer_documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."customer_memos" ADD CONSTRAINT "customer_memos_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."customer_schedules" ADD CONSTRAINT "customer_schedules_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."customer_tasks" ADD CONSTRAINT "customer_tasks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."quote_scenarios" ADD CONSTRAINT "quote_scenarios_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "crm"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customers"("id") ON DELETE no action ON UPDATE no action;
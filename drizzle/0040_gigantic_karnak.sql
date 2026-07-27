CREATE TABLE "crm"."dealer_trim_discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trim_id" bigint NOT NULL,
	"dealer_user_id" uuid NOT NULL,
	"financial_amount" integer,
	"partner_amount" integer,
	"cash_amount" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealer_trim_discounts_trim_dealer_unique" UNIQUE("trim_id","dealer_user_id")
);

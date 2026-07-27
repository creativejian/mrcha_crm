CREATE TABLE "crm"."catalog_discount_adoptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trim_id" bigint NOT NULL,
	"field" text NOT NULL,
	"amount" integer,
	"previous_amount" integer,
	"source_dealer_user_id" uuid,
	"adopted_by" uuid NOT NULL,
	"adopted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_discount_adoptions_field_check" CHECK ("crm"."catalog_discount_adoptions"."field" in ('financial','partner','cash'))
);

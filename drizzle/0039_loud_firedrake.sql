CREATE TABLE "crm"."dealer_profiles" (
	"dealer_user_id" uuid PRIMARY KEY NOT NULL,
	"brand_id" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

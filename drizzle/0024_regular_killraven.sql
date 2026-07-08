CREATE TABLE "crm"."staff_settings" (
	"staff_user_id" uuid PRIMARY KEY NOT NULL,
	"live_receiving" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

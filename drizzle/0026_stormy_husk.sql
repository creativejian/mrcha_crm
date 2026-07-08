CREATE TABLE "crm"."consultation_dismissals" (
	"consultation_id" uuid PRIMARY KEY NOT NULL,
	"dismissed_by" uuid,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);

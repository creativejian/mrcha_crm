ALTER TABLE "crm"."quotes" ADD COLUMN "bond_included" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."quotes" ADD COLUMN "delivery_included" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."quotes" ADD COLUMN "incidental_included" boolean DEFAULT false NOT NULL;
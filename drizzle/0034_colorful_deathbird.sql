ALTER TABLE "crm"."customers" ADD COLUMN "phone_secondary" text;--> statement-breakpoint
-- 백필(CHECK보다 먼저 — 위반 행이 있으면 제약 추가가 실패한다): 앱 연결 고객의 phone 스냅샷 폐기.
-- 실측 대상 1행(제임스 CU-2606-0002, 값이 더미 01012345678이라 secondary 이동 없이 폐기 — spec §4).
UPDATE "crm"."customers" SET "phone" = NULL WHERE "app_user_id" IS NOT NULL AND "phone" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD CONSTRAINT "customers_phone_app_exclusive_check" CHECK ("crm"."customers"."app_user_id" IS NULL OR "crm"."customers"."phone" IS NULL);
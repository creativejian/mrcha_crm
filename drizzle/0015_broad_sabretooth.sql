ALTER TABLE "crm"."customers" DROP CONSTRAINT "customers_source_check";--> statement-breakpoint
-- 라벨 리네임 백필: 새 CHECK가 기존 '앱 견적비교' 행을 위반으로 판정하므로 drop↔add 사이에서 갱신(원자).
UPDATE "crm"."customers" SET "source" = '앱 견적요청' WHERE "source" = '앱 견적비교';--> statement-breakpoint
ALTER TABLE "crm"."customers" ADD CONSTRAINT "customers_source_check" CHECK ("crm"."customers"."source" IS NULL OR "crm"."customers"."source" IN ('앱 견적요청', '앱 AI상담', '앱 상담원 연결', '디엘(상담)', '디엘(견적서)', '대표전화', '카카오', '소개', '추천', '재구매', '유튜브', '검색', '기타'));
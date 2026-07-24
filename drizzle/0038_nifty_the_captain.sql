ALTER TABLE "crm"."customers" ADD COLUMN "need_trim_id" bigint;--> statement-breakpoint
-- cross-schema FK는 schemaFilter=["crm"]라 drizzle generate가 산출하지 못해 수기로 잇는다
-- (crm.quotes → catalog 선례: drizzle/0001_crm_catalog_fk.sql).
-- ON DELETE SET NULL — 앱의 catalog 트림 삭제를 막지 않는다. need_model/need_trim이 표시용
-- 스냅샷으로 남으므로 링크가 끊겨도 "무슨 차에 관심이었는지"는 보존된다.
ALTER TABLE "crm"."customers"
  ADD CONSTRAINT "customers_need_trim_id_catalog_trims_fk"
  FOREIGN KEY ("need_trim_id") REFERENCES "catalog"."trims"("id") ON DELETE SET NULL;

-- crm.quotes → catalog 외부 FK (모두 ON DELETE SET NULL — 앱의 catalog 삭제를 막지 않음).
-- schemaFilter=["crm"]라 drizzle generate는 이 cross-schema FK를 산출하지 못하므로 수기 작성한다.
-- crm.quotes는 brand/model/trim·색상 이름을 비정규화 저장하므로 SET NULL로 링크가 끊겨도 견적 데이터는 보존된다.
-- public FK(app_user_id/advisor_id/source_*)는 의도적으로 보류(loose id) — 앱 소유 도메인 경계 유지.
ALTER TABLE "crm"."quotes"
  ADD CONSTRAINT "quotes_trim_id_catalog_trims_fk"
  FOREIGN KEY ("trim_id") REFERENCES "catalog"."trims"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "crm"."quotes"
  ADD CONSTRAINT "quotes_exterior_color_id_catalog_colors_fk"
  FOREIGN KEY ("exterior_color_id") REFERENCES "catalog"."colors"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "crm"."quotes"
  ADD CONSTRAINT "quotes_interior_color_id_catalog_colors_fk"
  FOREIGN KEY ("interior_color_id") REFERENCES "catalog"."colors"("id") ON DELETE SET NULL;

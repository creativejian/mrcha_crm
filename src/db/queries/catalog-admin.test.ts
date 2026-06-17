import { expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";

import { brandsInCatalog, modelsInCatalog, trimOptionsInCatalog, trimsInCatalog } from "../catalog";
import { db } from "../client";
import {
  createModel,
  createOption,
  createTrim,
  deleteModel,
  reorderCatalog,
  updateModel,
  updateTrim,
} from "./catalog-admin";

// 모든 쓰기를 하나의 tx 안에서 수행하고 끝에서 강제 throw로 롤백 → 라이브 master 무변경.
// 트리거(BEFORE INSERT sort_order 등)는 tx 안에서도 실행되므로 효과를 검증할 수 있다.
class Rollback extends Error {}

test("catalog-admin CRUD (tx 롤백, prod 무변경)", async () => {
  let ranToEnd = false;
  await db
    .transaction(async (tx) => {
      // 수입 브랜드 선택: 국산은 trim_name '서브라인 - 등급' 형식 트리거(enforce_domestic_trim_name_format)가 걸린다.
      const [brand] = await tx
        .select({ id: brandsInCatalog.id })
        .from(brandsInCatalog)
        .where(eq(brandsInCatalog.isDomestic, false))
        .limit(1);
      expect(brand).toBeDefined();

      // 모델 생성 → sort_order 트리거 자동 부여
      const model = await createModel(
        { brandId: brand.id, name: "__CRM_TEST_MODEL__", category: "중형 세단", status: "판매중" },
        tx,
      );
      expect(model.id).toBeGreaterThan(0);
      expect(model.sortOrder).not.toBeNull();

      // 모델 수정(category)
      const updated = await updateModel(model.id, { category: "대형 SUV" }, tx);
      expect(updated?.category).toBe("대형 SUV");

      // 트림 생성 → canonical 자동, sort_order 트리거, name=trim_name
      const trim = await createTrim(
        { modelId: model.id, trimName: "테스트트림", price: 50000000, modelYear: 2026, fuelType: "가솔린" },
        tx,
      );
      expect(trim.canonicalName).toContain("테스트트림");
      expect(trim.name).toBe("테스트트림");
      expect(trim.sortOrder).not.toBeNull();

      // 트림 수정
      const trimUp = await updateTrim(trim.id, { price: 51000000, status: "출시예정" }, tx);
      expect(Number(trimUp?.price)).toBe(51000000);
      expect(trimUp?.status).toBe("출시예정");

      // 순서변경(reorder) — 트림 2개를 뒤집어 sort_order 반영 확인
      const trim2 = await createTrim(
        { modelId: model.id, trimName: "테스트트림2", price: 60000000, modelYear: 2026, fuelType: "가솔린" },
        tx,
      );
      await reorderCatalog("trims", [trim2.id, trim.id], tx);
      const ordered = await tx
        .select({ id: trimsInCatalog.id })
        .from(trimsInCatalog)
        .where(eq(trimsInCatalog.modelId, model.id))
        .orderBy(asc(trimsInCatalog.sortOrder));
      expect(ordered[0]?.id).toBe(trim2.id);
      expect(ordered[1]?.id).toBe(trim.id);

      // 옵션 생성 + tx 내부 연결 확인
      const opt = await createOption({ trimId: trim.id, type: "tuning", name: "테스트옵션", price: 1000000 }, tx);
      expect(opt.id).toBeGreaterThan(0);
      const optsInTx = await tx
        .select({ id: trimOptionsInCatalog.id })
        .from(trimOptionsInCatalog)
        .where(eq(trimOptionsInCatalog.trimId, trim.id));
      expect(optsInTx.length).toBe(1);

      // 모델 삭제 → 트림·옵션 FK CASCADE
      await deleteModel(model.id, tx);
      const trimsLeft = await tx
        .select({ id: trimsInCatalog.id })
        .from(trimsInCatalog)
        .where(eq(trimsInCatalog.id, trim.id));
      expect(trimsLeft.length).toBe(0);
      const optsLeft = await tx
        .select({ id: trimOptionsInCatalog.id })
        .from(trimOptionsInCatalog)
        .where(eq(trimOptionsInCatalog.id, opt.id));
      expect(optsLeft.length).toBe(0);

      ranToEnd = true;
      throw new Rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });

  // 모델/모델삭제 검증 블록을 끝까지 실행했는지(중간 early-return 방지)
  expect(ranToEnd).toBe(true);

  // 롤백 후 prod에 남지 않았는지(다른 연결로 확인)
  const leftover = await db
    .select({ id: modelsInCatalog.id })
    .from(modelsInCatalog)
    .where(eq(modelsInCatalog.name, "__CRM_TEST_MODEL__"));
  expect(leftover.length).toBe(0);
});

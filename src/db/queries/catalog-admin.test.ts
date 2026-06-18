import { expect, test } from "bun:test";
import { and, asc, eq, isNotNull } from "drizzle-orm";

import { brandsInCatalog, modelsInCatalog, trimOptionsInCatalog, trimsInCatalog } from "../catalog";
import { getDefaultDb } from "../client";
import {
  assignMcCodes,
  createModel,
  createOption,
  createTrim,
  deleteModel,
  listModelOptionSummary,
  moveTrims,
  reorderCatalog,
  setTrimNoOption,
  unsetTrimNoOption,
  updateModel,
  updateTrim,
} from "./catalog-admin";

// 모든 쓰기를 하나의 tx 안에서 수행하고 끝에서 강제 throw로 롤백 → 라이브 master 무변경.
// 트리거(BEFORE INSERT sort_order 등)는 tx 안에서도 실행되므로 효과를 검증할 수 있다.
class Rollback extends Error {}

test("catalog-admin CRUD (tx 롤백, prod 무변경)", async () => {
  let ranToEnd = false;
  await getDefaultDb()
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

      // 트림 수정(가격·상태·할인)
      const trimUp = await updateTrim(
        trim.id,
        { price: 51000000, status: "출시예정", financialDiscountAmount: 1000000 },
        tx,
      );
      expect(Number(trimUp?.price)).toBe(51000000);
      expect(trimUp?.status).toBe("출시예정");
      expect(trimUp?.financialDiscountAmount).toBe(1000000);

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
  const leftover = await getDefaultDb()
    .select({ id: modelsInCatalog.id })
    .from(modelsInCatalog)
    .where(eq(modelsInCatalog.name, "__CRM_TEST_MODEL__"));
  expect(leftover.length).toBe(0);
});

test("옵션 요약 + 무옵션 확정 토글 (tx 롤백, prod 무변경)", async () => {
  await getDefaultDb()
    .transaction(async (tx) => {
      const [brand] = await tx
        .select({ id: brandsInCatalog.id })
        .from(brandsInCatalog)
        .where(eq(brandsInCatalog.isDomestic, false))
        .limit(1);
      const model = await createModel({ brandId: brand.id, name: "__OPT_MODEL__", category: null, status: "판매중" }, tx);
      const trim = await createTrim(
        { modelId: model.id, trimName: "옵트트림", price: 1000, modelYear: 2026, fuelType: "가솔린" },
        tx,
      );

      // 옵션 0개 → 무옵션 확정 가능
      await setTrimNoOption(trim.id, tx);
      let s = (await listModelOptionSummary(model.id, tx)).find((x) => x.trimId === trim.id);
      expect(s?.noOption).toBe(true);
      expect(s?.basic).toBe(0);
      expect(s?.tuning).toBe(0);

      // 옵션이 있으면 무옵션 확정 불가
      await createOption({ trimId: trim.id, type: "basic", name: "기본옵션", price: 100 }, tx);
      await createOption({ trimId: trim.id, type: "tuning", name: "튜닝옵션", price: 200 }, tx);
      let blocked = false;
      try {
        await setTrimNoOption(trim.id, tx);
      } catch {
        blocked = true;
      }
      expect(blocked).toBe(true);

      s = (await listModelOptionSummary(model.id, tx)).find((x) => x.trimId === trim.id);
      expect(s?.basic).toBe(1);
      expect(s?.tuning).toBe(1);

      await unsetTrimNoOption(trim.id, tx);
      throw new Rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
});

test("moveTrims: 다른 모델로 이동 + sort_order 재부여 (tx 롤백, prod 무변경)", async () => {
  await getDefaultDb()
    .transaction(async (tx) => {
      const [brand] = await tx
        .select({ id: brandsInCatalog.id })
        .from(brandsInCatalog)
        .where(eq(brandsInCatalog.isDomestic, false))
        .limit(1);
      const modelA = await createModel({ brandId: brand.id, name: "__MOVE_A__", category: null, status: "판매중" }, tx);
      const modelB = await createModel({ brandId: brand.id, name: "__MOVE_B__", category: null, status: "판매중" }, tx);
      // B에 기존 트림 1개(sort_order 1 차지) → 이동 시 충돌하면 안 됨
      await createTrim({ modelId: modelB.id, trimName: "B기존", price: 1000, modelYear: 2026, fuelType: "가솔린" }, tx);
      const t = await createTrim(
        { modelId: modelA.id, trimName: "이동대상", price: 2000, modelYear: 2026, fuelType: "가솔린" },
        tx,
      );

      const res = await moveTrims([t.id], modelB.id, tx);
      expect(res.moved).toBe(1);

      const [moved] = await tx
        .select({ modelId: trimsInCatalog.modelId, sortOrder: trimsInCatalog.sortOrder })
        .from(trimsInCatalog)
        .where(eq(trimsInCatalog.id, t.id));
      expect(moved.modelId).toBe(modelB.id);
      expect(Number(moved.sortOrder)).toBeGreaterThanOrEqual(2); // B 기존 max(1) + 1

      throw new Rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
});

test("assignMcCodes: 미부여 트림에 trim_code 채번 → mc_code 자동 생성 (tx 롤백, prod 무변경)", async () => {
  await getDefaultDb()
    .transaction(async (tx) => {
      // 브랜드/모델 코드가 모두 있는 모델 선택(없으면 mc_code 생성 불가).
      const [m] = await tx
        .select({ id: modelsInCatalog.id })
        .from(modelsInCatalog)
        .innerJoin(brandsInCatalog, eq(brandsInCatalog.id, modelsInCatalog.brandId))
        .where(and(isNotNull(modelsInCatalog.modelCode), isNotNull(brandsInCatalog.brandCode)))
        .limit(1);
      expect(m).toBeDefined();

      // 새 트림 2개(연식 포함) → 삽입 직후 mc_code null. ' - ' 형식이라 국산/수입 모두 안전.
      const t1 = await createTrim(
        { modelId: m.id, trimName: "__MC_T1__ - 기본", price: 1000, modelYear: 2026, fuelType: "가솔린" },
        tx,
      );
      await createTrim(
        { modelId: m.id, trimName: "__MC_T2__ - 기본", price: 2000, modelYear: 2026, fuelType: "가솔린" },
        tx,
      );
      expect(t1.mcCode).toBeNull();

      const res = await assignMcCodes(m.id, tx);
      expect(res.assigned).toBeGreaterThanOrEqual(2);

      // trim_code 부여 + 트리거가 mc_code(MC+9자리) 생성.
      const [r1] = await tx
        .select({ mcCode: trimsInCatalog.mcCode, trimCode: trimsInCatalog.trimCode })
        .from(trimsInCatalog)
        .where(eq(trimsInCatalog.id, t1.id));
      expect(r1.trimCode).not.toBeNull();
      expect(r1.mcCode).toMatch(/^MC\d{9}$/);

      throw new Rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
});

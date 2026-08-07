import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { getDefaultDb } from "../db/client";
import { formatResidue, residueCount, scanFixtureResidue } from "./fixture-residue";
import { withNotifyGuard } from "./notify-gate";

const db = getDefaultDb();

// ── 공유 master 위생 ────────────────────────────────────────────────
// `bun test`는 파일을 순차 실행하고 각 파일의 afterAll이 다음 파일 시작 전에 끝난다.
// 그래서 이 검사가 어느 순서에 돌든, **run 시작 시점에 이미 DB에 있던 잔재**는 반드시 잡힌다.
// 우리가 실제로 당한 실패 모드가 바로 그것이다 — 07-09에 끊긴 실행이 남긴 `CU-EMBRT-…/배선테스트`가
// 이사님 고객 목록에 유령으로 떴고, 사람 눈이 발견할 때까지 하루 넘게 살아 있었다.
//
// 같은 run의 **마지막** 파일이 남긴 잔재는 다음 run이 잡는다. 완벽하진 않지만 사람 눈보다 낫다.

test("공유 master에 테스트 픽스처 잔재가 없다", async () => {
  const residue = await scanFixtureResidue(db);
  if (residueCount(residue) > 0) {
    console.error(`\n[residue] 공유 master에 테스트 잔재가 남아 있습니다:\n${formatResidue(residue)}\n`);
    console.error(`  정리: bun run check:residue -- --clean   (crm 스키마만 지웁니다)\n`);
  }
  // 실패했다면 이전 실행이 중간에 끊겼을 가능성이 높다. 위 명령으로 정리할 것.
  // 고아 앱 카드는 앱 화면에 유령 견적으로 보이므로 자동 삭제하지 않는다 — 수동 확인 필요.
  expect(residueCount(residue)).toBe(0);
});

// ── 검사 자체 검증 ─────────────────────────────────────────────────
// "잔재 0건"만 단언하면 정규식이 고장 나도 초록불이 켜진다. 심어서 잡히는지 본다.

test("검사기: 잔재를 실제로 탐지한다(트랜잭션 롤백)", async () => {
  // 기존 잔재 유무와 무관하게 성립해야 한다 — 위 테스트가 이미 0건을 단언하므로
  // 여기서 다시 0을 가정하면 잔재가 있을 때 실패 원인이 둘로 갈려 읽기 어려워진다. 델타만 본다.
  const baseline = residueCount(await scanFixtureResidue(db));

  await db
    .transaction(async (tx) => {
      await tx.execute(sql`insert into crm.customers (customer_code, name) values ('CU-DEL-residue-probe', '잔재프로브')`);
      const after = await scanFixtureResidue(tx as unknown as typeof db);
      expect(after.customers.map((c) => c.customerCode)).toContain("CU-DEL-residue-probe");
      expect(residueCount(after)).toBe(baseline + 1);
      throw new Error("rollback"); // 심은 행을 남기지 않는다
    })
    .catch((e: unknown) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });

  // 롤백 확인 — 공유 master에 프로브가 남지 않았다
  const restored = await scanFixtureResidue(db);
  expect(restored.customers.map((c) => c.customerCode)).not.toContain("CU-DEL-residue-probe");
  expect(residueCount(restored)).toBe(baseline);
});

test("검사기: 실채번 코드여도 등록된 픽스처 이름이면 잡는다(트랜잭션 롤백)", async () => {
  const baseline = residueCount(await scanFixtureResidue(db));

  await db
    .transaction(async (tx) => {
      // 코드는 어떤 registry 접두사와도 무관한 값 — 이름이 유일한 검출 경로임을 증명한다.
      // (POST /api/customers 라우트 테스트가 만드는 실채번 픽스처가 정확히 이 모양이다.)
      await tx.execute(sql`insert into crm.customers (customer_code, name) values ('RESIDUE-NAME-PROBE', '수기등록테스트')`);
      const after = await scanFixtureResidue(tx as unknown as typeof db);
      expect(after.customers.map((c) => c.name)).toContain("수기등록테스트");
      expect(residueCount(after)).toBe(baseline + 1);
      throw new Error("rollback"); // 심은 행을 남기지 않는다
    })
    .catch((e: unknown) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });

  const restored = await scanFixtureResidue(db);
  expect(restored.customers.map((c) => c.name)).not.toContain("수기등록테스트");
  expect(residueCount(restored)).toBe(baseline);
});

test("검사기: 상담신청 잔재를 탐지한다 — 원미래 created_at·registry 이름 양쪽(withNotifyGuard 롤백)", async () => {
  const baseline = residueCount(await scanFixtureResidue(db));

  // ⚠️ public.consultations INSERT는 handle_new_consultation 트리거(운영 디스코드 알림)를 깨운다 —
  // 반드시 withNotifyGuard 트랜잭션 안에서만 심는다. 롤백은 pg_net도 취소하지만(실측) 가드가 1겹 더.
  await withNotifyGuard(db, async (tx) => {
    await tx.execute(sql`
      insert into public.consultations (id, customer_name, phone_number, status, created_at) values
        (${crypto.randomUUID()}, '원미래잔재프로브', '01000000000', 'pending', now() + interval '100 years'),
        (${crypto.randomUUID()}, '도구테스트', '01000000000', 'pending', now())`);
    const after = await scanFixtureResidue(tx as unknown as typeof db);
    const names = after.consultations.map((c) => c.customerName);
    expect(names).toContain("원미래잔재프로브"); // created_at > now() 절 — 이름 registry 밖이어도 잡힌다
    expect(names).toContain("도구테스트"); // 이름 registry 절 — 현재 시각이어도 잡힌다
    expect(residueCount(after)).toBe(baseline + 2);
    throw new Error("rollback"); // 심은 행을 남기지 않는다
  }).catch((e: unknown) => {
    if (!(e instanceof Error) || e.message !== "rollback") throw e;
  });

  const restored = await scanFixtureResidue(db);
  expect(restored.consultations.map((c) => c.customerName)).not.toContain("원미래잔재프로브");
  expect(residueCount(restored)).toBe(baseline);
});

test("검사기: 견적요청 잔재를 탐지한다 — 전용 테스트 profile 소유 행(트랜잭션 롤백)", async () => {
  const baseline = residueCount(await scanFixtureResidue(db));
  const probeId = crypto.randomUUID();

  // public.quote_requests엔 코드 컬럼이 없어 접두사 registry로는 못 잡는다 — 픽스처 요청이 전부
  // 전용 profile 앞으로 만들어진다는 성질(TEST_APP_PROFILE_NAMES)이 유일한 열쇠다.
  // ⚠️ 이 테이블은 알림 트리거가 0개라 withNotifyGuard가 필요 없다. BEFORE 트리거
  // `reject_locked_account_mutation`은 `auth.uid()` 기반이라 postgres 롤에서는 통과한다(실측).
  await db.transaction(async (tx) => {
    // 프로필 조회를 서브쿼리로 둔다 — 그 계정이 없으면 0행이 들어가고 아래 단언이 실패해
    // "전용 profile이 사라졌다"는 사실 자체가 드러난다(조용한 통과 방지).
    await tx.execute(sql`
      insert into public.quote_requests (id, user_id, status, created_at)
      select ${probeId}, p.id, 'open', now() from public.profiles p
      where p.full_name = '상담사테스트' limit 1`);
    const after = await scanFixtureResidue(tx as unknown as typeof db);
    expect(after.quoteRequests.map((q) => q.id)).toContain(probeId);
    expect(residueCount(after)).toBe(baseline + 1);
    throw new Error("rollback"); // 심은 행을 남기지 않는다 — 남으면 전역 인박스에 유령 카드가 뜬다
  }).catch((e: unknown) => {
    if (!(e instanceof Error) || e.message !== "rollback") throw e;
  });

  const restored = await scanFixtureResidue(db);
  expect(restored.quoteRequests.map((q) => q.id)).not.toContain(probeId);
  expect(residueCount(restored)).toBe(baseline);
});

test("검사기: customer_deletions 감사 잔재를 탐지한다 — 코드 접두사·이름 registry 양쪽(트랜잭션 롤백)", async () => {
  const baseline = residueCount(await scanFixtureResidue(db));

  await db
    .transaction(async (tx) => {
      // 고객 행이 이미 삭제돼 감사 행만 남은 시나리오 — scan이 못 보면 조기 exit 때문에 --clean에
      // 영영 도달하지 못한다(clean은 이 행을 지울 줄 안다). 이름 케이스 코드는 registry 접두사와
      // 무관한 값('RESIDUE-…')으로 둬 이름이 유일한 검출 경로임을 증명한다.
      await tx.execute(sql`
        insert into crm.customer_deletions (customer_id, customer_code, name, deleted_by) values
          (${crypto.randomUUID()}, 'CU-DEL-audit-probe', '감사코드프로브', ${crypto.randomUUID()}),
          (${crypto.randomUUID()}, 'RESIDUE-AUDIT-PROBE', '수기등록테스트', ${crypto.randomUUID()})`);
      const after = await scanFixtureResidue(tx as unknown as typeof db);
      const codes = after.deletionAudits.map((d) => d.customerCode);
      expect(codes).toContain("CU-DEL-audit-probe"); // 코드 접두사 절
      expect(codes).toContain("RESIDUE-AUDIT-PROBE"); // 이름 registry 절
      expect(residueCount(after)).toBe(baseline + 2);
      throw new Error("rollback"); // 심은 행을 남기지 않는다
    })
    .catch((e: unknown) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });

  const restored = await scanFixtureResidue(db);
  expect(restored.deletionAudits.map((d) => d.customerCode)).not.toContain("CU-DEL-audit-probe");
  expect(residueCount(restored)).toBe(baseline);
});

test("검사기: 딜러 3테이블의 고아 잔재를 탐지한다(트랜잭션 롤백)", async () => {
  const baseline = residueCount(await scanFixtureResidue(db));
  const ghost = crypto.randomUUID(); // profiles에 없는 유저 = 딜러 테스트가 쓰는 모양 그대로

  await db
    .transaction(async (tx) => {
      // brand_id·trim_id는 FK가 없다(loose id 정책) — 고아 판정은 dealer_user_id/adopted_by만 본다.
      await tx.execute(sql`insert into crm.dealer_profiles (dealer_user_id, brand_id) values (${ghost}, 1)`);
      await tx.execute(sql`
        insert into crm.dealer_trim_discounts (trim_id, dealer_user_id, financial_amount)
        values (1, ${ghost}, 1234)`);
      await tx.execute(sql`
        insert into crm.catalog_discount_adoptions (trim_id, field, amount, previous_amount, adopted_by)
        values (1, 'financial', 1234, null, ${ghost})`);
      const after = await scanFixtureResidue(tx as unknown as typeof db);
      expect(after.orphanDealerProfiles.map((d) => d.dealerUserId)).toContain(ghost);
      expect(after.orphanDealerDiscounts.map((d) => d.dealerUserId)).toContain(ghost);
      expect(after.orphanAdoptions.map((a) => a.trimId)).toContain(1);
      expect(residueCount(after)).toBe(baseline + 3);
      // 채택 감사는 report-only라 되돌리기 SQL이 함께 안내돼야 한다(지우면 복원 근거가 사라진다).
      expect(formatResidue(after)).toContain("update catalog.trims set financial_discount_amount = null where id = 1;");
      throw new Error("rollback"); // 심은 행을 남기지 않는다
    })
    .catch((e: unknown) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });

  const restored = await scanFixtureResidue(db);
  expect(restored.orphanDealerProfiles.map((d) => d.dealerUserId)).not.toContain(ghost);
  expect(residueCount(restored)).toBe(baseline);
});

test("검사기: 실제 앱 유저의 딜러 매칭은 잔재가 아니다(고아 판정의 오탐 방지)", async () => {
  const baseline = residueCount(await scanFixtureResidue(db));
  // 실 유저를 하드코딩하지 않고 집는다 — 아직 딜러 매칭이 없는 사람이어야 PK가 비어 있다.
  const [real] = (await db.execute(sql`
    select id::text from public.profiles p
    where not exists (select 1 from crm.dealer_profiles dp where dp.dealer_user_id = p.id)
    limit 1`)) as unknown as { id: string }[];
  expect(real?.id).toBeDefined();

  await db
    .transaction(async (tx) => {
      await tx.execute(sql`insert into crm.dealer_profiles (dealer_user_id, brand_id) values (${real!.id}, 1)`);
      await tx.execute(sql`
        insert into crm.dealer_trim_discounts (trim_id, dealer_user_id, financial_amount)
        values (1, ${real!.id}, 1234)`);
      // profiles에 있는 유저이므로 정상 데이터다 — 잔재 카운트가 움직이면 실 딜러 데이터를
      // --clean이 지운다는 뜻이고, 그건 이사님이 매칭한 브랜드가 사라지는 사고다.
      expect(residueCount(await scanFixtureResidue(tx as unknown as typeof db))).toBe(baseline);
      throw new Error("rollback");
    })
    .catch((e: unknown) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
});

// "실채번 코드를 잔재로 오인하지 않는다"는 단언은 fixture-codes.test.ts에 있다.
// 이 파일은 getDefaultDb를 쓰므로 registry 계약 스캔의 대상이고, 여기에 `CU-2606-0001` 같은
// 실채번 리터럴을 적으면 **그 스캔이 자기 형제를 위반으로 잡는다**(실제로 그렇게 됐다).
// 스캔은 "DB 쓰는 파일에 미등록 코드 리터럴이 있으면 위반"이라 문맥(단언인지 INSERT인지)을 못 본다.

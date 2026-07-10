import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { getDefaultDb } from "../db/client";
import { formatResidue, residueCount, scanFixtureResidue } from "./fixture-residue";

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

// "실채번 코드를 잔재로 오인하지 않는다"는 단언은 fixture-codes.test.ts에 있다.
// 이 파일은 getDefaultDb를 쓰므로 registry 계약 스캔의 대상이고, 여기에 `CU-2606-0001` 같은
// 실채번 리터럴을 적으면 **그 스캔이 자기 형제를 위반으로 잡는다**(실제로 그렇게 됐다).
// 스캔은 "DB 쓰는 파일에 미등록 코드 리터럴이 있으면 위반"이라 문맥(단언인지 INSERT인지)을 못 본다.

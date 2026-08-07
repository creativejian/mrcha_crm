import { expect, test } from "bun:test";

import { withNotifyGuard } from "../../test-utils/notify-gate";
import { getTestDb } from "../../test-utils/hermetic-db";
import { customerDeliveries, customers } from "../schema";
import { getAdminReport } from "./reports";

// 실적 귀속 기준일 = **계약 확정일**(`#436`이 차량 인도일 기준을 정정) — 그 정정을 잠근다.
//
// 왜 별도 파일인가: `reports.test.ts`는 "**픽스처를 만들지 않는다**"가 명시 원칙이고(집계 SQL의
// 문법·바인딩 회귀만 본다), 이 계약은 **인도일과 확정일이 서로 다른 달인 행**이 있어야만 검증된다.
// 그 원칙을 깨는 대신 파일을 가른다.
//
// 배경(2026-08-06 배치 16 변이 실측): `#436`은 `reports.ts`만 고치고 `reports.test.ts`를 **건드리지
// 않았다.** 그 파일 단언이 전부 불변식(`소계 합 == 전체 대수` · `금액 >= 0` · 정렬)이라
// **`contractConfirmedDate`를 `deliveredDate`로 되돌려도 전량 통과**한다(실제로 주입해 확인).
// 되돌아가면 경영 리포트의 월별 실적이 통째로 다른 달에 귀속되는데 화면에 오류 표시가 전혀 없다 —
// "출고"가 계약 확정과 차량 인도 두 사건을 가리키는 이 도메인의 어휘 함정이 `#432`→`#436` 오구현을
// 낳았고, 그 정정을 지키는 그물이 없었다.
//
// ⚠️ 공유 master라 **개수 단언 금지**(다른 세션·테스트의 행이 섞인다). 픽스처 삽입 **전후의 증분**만
// 본다 — 데이터가 얼마나 있든 성립하고, 기준일이 뒤집히면 증분이 반대 달에 나타난다.
// dual-mode(hermetic-db.ts): 로컬 test:server = 실 master(기존 그대로), CI test:pure = PGlite.
const db = await getTestDb();
const ROLLBACK = "__rollback__";
const code = () => `CU-REVBASIS-${crypto.randomUUID().slice(0, 8)}`;

// 두 사건을 **다른 달**에 둔다. 같은 달이면 어느 컬럼을 봐도 결과가 같아 검증력이 0이 된다.
const DELIVERED_MONTH = "2026-03";
const CONFIRMED_MONTH = "2026-04";

test("실적은 계약 확정일 달에 귀속된다 — 차량 인도일 달이 아니다(#436)", async () => {
  await expect(
    withNotifyGuard(db, async (tx) => {
      const before = {
        delivered: await getAdminReport(DELIVERED_MONTH, tx),
        confirmed: await getAdminReport(CONFIRMED_MONTH, tx),
      };

      const [c] = await tx
        .insert(customers)
        .values({ customerCode: code(), name: "실적귀속기준테스트" })
        .returning({ id: customers.id });
      await tx.insert(customerDeliveries).values({
        customerId: c.id,
        lender: "테스트캐피탈",
        deliveredDate: `${DELIVERED_MONTH}-15`,
        contractConfirmedDate: `${CONFIRMED_MONTH}-20`,
      });

      const after = {
        delivered: await getAdminReport(DELIVERED_MONTH, tx),
        confirmed: await getAdminReport(CONFIRMED_MONTH, tx),
      };

      // 확정일 달에 +1, 인도일 달은 불변. 기준일을 되돌리면 이 둘이 정확히 뒤바뀐다.
      expect(after.confirmed.delivery.count).toBe(before.confirmed.delivery.count + 1);
      expect(after.delivered.delivery.count).toBe(before.delivered.delivery.count);

      // 전월 비교 칩도 같은 기준을 써야 한다 — 확정일 달 리포트의 prevCount(=인도일 달)는 불변이다.
      // 여기가 어긋나면 화면이 "이번 달 +1, 지난달도 +1"처럼 스스로를 반박한다.
      expect(after.confirmed.delivery.prevCount).toBe(before.confirmed.delivery.prevCount);

      // 구매방식별 대수도 같은 축이다(견적이 없으면 "미지정"으로 묶인다 — 조용히 빠지면 안 된다).
      const methodCount = (r: Awaited<ReturnType<typeof getAdminReport>>) =>
        r.delivery.countByMethod.reduce((sum, row) => sum + row.count, 0);
      expect(methodCount(after.confirmed)).toBe(methodCount(before.confirmed) + 1);

      throw new Error(ROLLBACK);
    }),
  ).rejects.toThrow(ROLLBACK);
});

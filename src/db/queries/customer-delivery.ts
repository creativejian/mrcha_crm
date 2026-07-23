import { eq, sql } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { customerDeliveries, customers, quotes } from "../schema";
import type { CustomerDeliveryInfo } from "../../../client/src/data/customers";

// 출고 정보 upsert(2026-07-20 출고 2단계 spec §4.2) — 고객당 1행(customer_id UNIQUE) 전체 교체.
// sourceQuoteId는 그 고객 소유 견적만 허용(타 고객 견적 id 주입 = provenance 오염 → 라우트 400 fail-loud).
// 미존재 quote id도 같은 분기(FK 위반을 400 이전에 잡는다 — 경합은 FK가 최후 방어).
// ⚠️경합 창(확인→INSERT 사이 고객/견적 삭제)의 FK 23503은 dbErrorMessage가 삭제 어휘("참조 중인
// 데이터가 있어 삭제할 수 없습니다")로 매핑한다 — 저장 실패에 오도 문구(배치 11 A#3 기록성 수용:
// ms 창·admin 드문 조작이라 봉쇄만 정확하면 충분. 문구 일반화는 삭제 경로 8콜사이트를 흐려 비권장).
export type UpsertCustomerDeliveryResult =
  | { kind: "saved"; row: typeof customerDeliveries.$inferSelect }
  | { kind: "customer_not_found" }
  | { kind: "quote_mismatch" };

export async function upsertCustomerDelivery(
  customerId: string,
  patch: CustomerDeliveryInfo,
  ex: Executor = getDefaultDb(),
): Promise<UpsertCustomerDeliveryResult> {
  const [customer] = await ex.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId));
  if (!customer) return { kind: "customer_not_found" };
  if (patch.sourceQuoteId) {
    const [q] = await ex.select({ customerId: quotes.customerId }).from(quotes).where(eq(quotes.id, patch.sourceQuoteId));
    if (!q || q.customerId !== customerId) return { kind: "quote_mismatch" };
  }
  const [row] = await ex
    .insert(customerDeliveries)
    .values({ customerId, ...patch })
    // ⚠️ **`updatedAt`은 DB 시계로 찍는다 — `new Date()`(앱 시계)를 쓰면 안 된다**(2026-07-23 실측 수정).
    // INSERT 경로의 `updated_at`은 스키마 `defaultNow()` = DB `now()`인데 UPDATE만 앱 시계로 찍고
    // 있어서, 앱↔DB 시계가 어긋난 만큼 **갱신할 때마다 스탬프가 과거로 되돌아갔다**(로컬 실측:
    // 앱이 2.08초 뒤처져 12/12 역전 — `updated_at < created_at`).
    // 이 컬럼은 `staffActivityAt`(queries/activity.ts)의 greatest() 항목이라 load-bearing이다 —
    // 목록의 "마지막 활동"·무활동 일수·`stale_customers`/`delivery_risk` 리포트·수동 관리 상태
    // 유효 판정이 전부 이 값을 본다. 뒤로 가면 "방금 저장했는데 더 오래 방치된 것"으로 읽힌다.
    .onConflictDoUpdate({ target: customerDeliveries.customerId, set: { ...patch, updatedAt: sql`now()` } })
    .returning();
  return { kind: "saved", row };
}

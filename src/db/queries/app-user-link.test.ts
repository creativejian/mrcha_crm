import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { getDefaultDb } from "../client";
import { customers } from "../schema";
import { applyAppUserLink } from "./app-user-link";
import { run } from "../../routes/shared";
import { anyUnlinkedProfileId } from "../../test-utils/profiles-fixture";

const db = getDefaultDb();

// customers_app_user_id_unique(partial unique index, 마이그 0030)의 DB 최후 방어선 계약.
// link/승격 가드는 잠금 없는 SELECT라 동시 요청의 TOCTOU 창을 못 닫는다 — 경합이 가드를 둘 다
// 통과해도 DB가 두 번째 커밋을 거부해야 app_user_id 중복 고객(요청 청크 귀속·staff scope 비결정)이
// 생기지 않는다. run() 경유로 단언해 "실 drizzle 래핑 에러(cause 체인) → 연결 충돌 문구" 매핑까지
// 한 번에 잠근다(top message만 보던 구 dbErrorMessage는 이 에러를 매핑하지 못했다 — 0713 실측).
// 트랜잭션은 reject로 롤백돼 잔재 0(코드도 registry 접두사 CU-SEND-).
test("app_user_id 중복 2행 → DB 거부 + run()이 연결 충돌 문구로 매핑", async () => {
  const userId = await anyUnlinkedProfileId();
  const code = () => `CU-SEND-${crypto.randomUUID().slice(0, 8)}`;
  const app = new Hono();
  app.post("/t", (c) =>
    run(c, () =>
      db.transaction(async (tx) => {
        await tx.insert(customers).values({ customerCode: code(), name: "발송훅테스트", appUserId: userId });
        await tx.insert(customers).values({ customerCode: code(), name: "발송훅테스트", appUserId: userId });
      }),
    ),
  );
  const res = await app.request("/t", { method: "POST" });
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "이 앱 계정은 이미 다른 고객에 연결돼 있습니다." });
});

// 연결이 `customers.updated_at`을 **DB 시계로 전진**시키는지(2026-07-23 `#335` 커버리지 보강).
// 이 컬럼은 `staffActivityAt`(queries/activity.ts)의 greatest() 첫 항목이라 load-bearing이다 —
// 목록의 "마지막 활동"·무활동 일수·`stale_customers`/`delivery_risk`·수동 관리 상태 유효 판정이
// 전부 이 값을 본다. 앱 계정 연결은 담당자 액션이라 그 시각이 전진해야 한다.
// ⚠️ **변이 실측으로 이 테스트의 필요를 확인했다**: `#335`가 바꾼 12곳에 `now() - interval '1 hour'`를
// 주입해 봤더니 이 지점만 **아무 테스트도 깨지지 않았다**(load-bearing인데 무커버). 나머지 무커버
// 8곳은 해당 `updated_at`을 읽는 코드가 아예 없어서 무커버가 정상이다(그쪽은 tripwire가 형태만 잠근다).
// 비교는 **DB 안에서** 한다 — JS Date는 ms 절삭이라 빠른 연속 실행에서 거짓 실패한다(`#334` 교훈).
test("applyAppUserLink: 연결이 customers.updated_at을 DB 시계로 전진시킨다(활동 파생 load-bearing)", async () => {
  const userId = await anyUnlinkedProfileId();
  await expect(
    db.transaction(async (tx) => {
      const [c] = await tx
        .insert(customers)
        .values({ customerCode: `CU-SEND-${crypto.randomUUID().slice(0, 8)}`, name: "발송훅테스트", updatedAt: sql`now() - interval '1 day'` })
        .returning({ id: customers.id });
      const linked = await applyAppUserLink(userId, c.id, tx);
      expect(linked?.appUserId).toBe(userId);
      const [row] = await tx
        .select({ bumped: sql<boolean>`${customers.updatedAt} > now() - interval '1 minute'` })
        .from(customers)
        .where(eq(customers.id, c.id));
      expect(row.bumped).toBe(true);
      throw new Error("__rollback__"); // 잔재 0 — 픽스처는 롤백으로 사라진다
    }),
  ).rejects.toThrow("__rollback__");
});

// NULL은 인덱스 밖(WHERE app_user_id IS NOT NULL) — 수기 고객(미연결) 다수는 계속 허용돼야 한다.
test("app_user_id NULL 다수는 허용(partial index — 수기 고객 불변)", async () => {
  await expect(
    db.transaction(async (tx) => {
      await tx.insert(customers).values({ customerCode: `CU-SEND-${crypto.randomUUID().slice(0, 8)}`, name: "발송훅테스트" });
      await tx.insert(customers).values({ customerCode: `CU-SEND-${crypto.randomUUID().slice(0, 8)}`, name: "발송훅테스트" });
      // 두 행 다 들어갔는지 확인 후 롤백(잔재 0)
      throw new Error("__rollback__");
    }),
  ).rejects.toThrow("__rollback__");
});

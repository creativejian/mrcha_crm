import { expect, test } from "bun:test";
import { Hono } from "hono";

import { getDefaultDb } from "../client";
import { customers } from "../schema";
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

import { expect, test } from "bun:test";
import { Hono } from "hono";

import { ConflictError, LinkConflictError } from "../lib/errors";
import { run } from "./shared";

// run()의 409 매핑 계약 — LinkConflictError는 충돌 고객 식별(conflict)을 본문에 동봉하고,
// 일반 ConflictError는 error 문자열만 싣는다(이사님 2026-07-13 ② "차단 유지 + 이유·경로 안내").
// DB 무접촉 순수 유닛: 실 라우트(quote-requests/consultations link)는 쿼리 계층 테스트가 throw를 잠근다.

test("run: LinkConflictError → 409 + conflict 구조화 동봉", async () => {
  const app = new Hono();
  app.post("/t", (c) =>
    run(c, () => {
      throw new LinkConflictError("이 앱 계정은 이미 홍길동(CU-2606-0012) 고객에 연결돼 있습니다.", {
        customerCode: "CU-2606-0012",
        name: "홍길동",
      });
    }),
  );
  const res = await app.request("/t", { method: "POST" });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    error: "이 앱 계정은 이미 홍길동(CU-2606-0012) 고객에 연결돼 있습니다.",
    conflict: { customerCode: "CU-2606-0012", name: "홍길동" },
  });
});

test("run: 일반 ConflictError → 409, conflict 키 없음(기존 계약 불변)", async () => {
  const app = new Hono();
  app.post("/t", (c) =>
    run(c, () => {
      throw new ConflictError("이 고객은 이미 다른 앱 계정에 연결돼 있습니다.");
    }),
  );
  const res = await app.request("/t", { method: "POST" });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "이 고객은 이미 다른 앱 계정에 연결돼 있습니다." });
});

// customers 고유 제약의 23505 매핑(0713 감사) — generic 문구("같은 모델에 동일한 트림명…")는
// catalog(트림) 전제라, link 경합·채번 경합에서 그대로 노출되면 완전히 오도된다. constraint 이름
// 선매칭이 이를 막는다. 상태코드는 500 유지 — 409는 가드(사전 SELECT)의 몫이고 이건 최후 방어선.

test("run: app_user_id unique 위반 → 연결 충돌 문구(트림 문구 아님)", async () => {
  const app = new Hono();
  app.post("/t", (c) =>
    run(c, () => {
      throw new Error('duplicate key value violates unique constraint "customers_app_user_id_unique"');
    }),
  );
  const res = await app.request("/t", { method: "POST" });
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "이 앱 계정은 이미 다른 고객에 연결돼 있습니다." });
});

test("run: customer_code unique 위반(채번 경합) → 재시도 안내 문구", async () => {
  const app = new Hono();
  app.post("/t", (c) =>
    run(c, () => {
      throw new Error('duplicate key value violates unique constraint "customers_customer_code_unique"');
    }),
  );
  const res = await app.request("/t", { method: "POST" });
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "고객 번호 채번이 겹쳤습니다. 잠시 후 다시 시도해 주세요." });
});

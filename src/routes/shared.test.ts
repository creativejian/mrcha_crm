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

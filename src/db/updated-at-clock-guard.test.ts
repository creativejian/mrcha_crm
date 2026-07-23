import { Glob } from "bun";
import { expect, test } from "bun:test";

// `updated_at`은 **DB 시계로만** 찍는다(2026-07-23 계약) — tripwire.
//
// 배경(실측): `customer_deliveries.updated_at`이 경로마다 다른 시계를 쓰고 있었다 —
// INSERT는 스키마 `defaultNow()`(DB 시계), UPDATE만 `new Date()`(앱 시계). 앱↔DB 시계가
// 어긋난 만큼 **갱신할 때마다 스탬프가 과거로 되돌아갔다**(로컬 실측: 앱이 2.08초 뒤처져
// upsert 12/12에서 `updated_at < created_at`). `#334`에서 그 한 곳을 고쳤고, 같은 형태가
// 9곳 더 있어 전부 DB 시계로 통일했다.
//
// 왜 기계로 잠그나:
//  1. **증상이 안 보인다.** 스탬프가 몇 초 과거로 찍혀도 화면은 멀쩡하고, 테스트도 "값이
//     바뀌었다"까지만 보면 통과한다. 실제로 구 단언(`not.toBe`)은 **스큐가 클수록 잘 통과**해
//     결함을 가렸다(`#334` 참조).
//  2. **load-bearing이다.** `customers.updated_at`과 `customer_deliveries.updated_at`은
//     `staffActivityAt`(queries/activity.ts)의 greatest() 항목이고, 그 값이 목록의 "마지막
//     활동"·무활동 일수·`stale_customers`/`delivery_risk` 리포트·수동 관리 상태 유효 판정을
//     결정한다. 뒤로 가면 "방금 저장했는데 더 오래 방치된 것"으로 읽힌다.
//  3. **지금 안 읽는 컬럼도 위험하다.** quotes·embeddings·staff_settings의 `updated_at`은
//     현재 서버에서 읽는 곳이 없지만, 나중에 누가 읽기 시작하면 조용히 틀린 값을 본다.
//     INSERT가 이미 DB 시계라 혼용 자체가 함정이다.
//
// 정규식을 좁혀 회피하지 말 것 — 앱 시계가 정말 필요한 자리가 생기면 여기 명시 등록해서
// "언제 누가 왜 열었는지"가 커밋에 남게 한다(profiles-write-guard와 같은 관례).
//
// ## 왜 `updatedAt`만 잠그나 (2026-07-23 전수 조사 — 같은 조사를 반복하지 않도록 결론을 남긴다)
//
// 다른 시각 컬럼도 앱 `new Date()`로 찍지만 **같은 결함이 아니다.** 이 버그의 정체는
// "앱 시계를 쓴 것" 자체가 아니라 **한 컬럼에 두 시계가 섞인 것**이고, 섞이는 조건은
// 스키마에 `defaultNow()`가 있어서 INSERT만 DB 시계로 가는 경우다.
//  - `received_at`·`assigned_at`·`sent_at`·`valid_until`·`saved_at` → **`defaultNow()`가 없다.**
//    INSERT·UPDATE 모두 앱이 명시 지정하므로 자기들끼리 일관이고, 역전이 원리적으로 생기지 않는다.
//  - `assistant_messages.created_at` → `defaultNow()`는 있지만 **모든 삽입이 명시 지정**한다
//    (단일 진입점 `routes/assistant.ts` insertTurn). 게다가 그 값은 user/assistant 두 행에
//    **의도적으로 1ms 차이**를 주는 순서 장치라(정렬 `desc(created_at), desc(id)`이고 id는 uuid라
//    2차 키가 순서를 못 잡는다) **DB `now()`로 바꾸면 같은 값이 되어 순서가 무너진다.**
//    = 앱 시계가 정당한 자리다. 바꾸지 말 것.
const SCAN_ROOTS = ["src", "functions", "scripts"];
const SELF = "src/db/updated-at-clock-guard.test.ts";

// 주석 안의 설명문("`updatedAt: new Date()`를 쓰면 안 된다")이 탐지에 걸리지 않게 먼저 걷어낸다.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// `updatedAt: new Date()` · `updatedAt: someJsDate` 형태를 잡는다.
// `sql\`now()\``와 스키마 `defaultNow()`는 통과 — 그게 유일한 정답 형태다.
const RE = /\bupdatedAt\s*:\s*(?!sql`)(?:new\s+Date\s*\(|\w+\s*[,}])/g;

// 앱 시계가 정당한 예외(현재 없음). 추가할 땐 사유를 한 줄 남길 것.
const ALLOW: { file: string; reason: string }[] = [];

// `updateCustomer`가 `manage_status_at`과 `updated_at`을 **각각 인라인 `sql\`now()\``**로 찍는 전제:
// 한 statement 안의 `now()`는 몇 번을 써도 같은 값(트랜잭션 시작 시각)이다. 이게 깨지면 스누즈가
// 켜자마자 만료될 수 있다(유효 규칙이 `manage_status_at >= staffActivityAt`이고 그 GREATEST에
// `updated_at`이 들어간다) — 주석으로 두지 않고 실 DB로 잠근다.
test("한 statement 안의 now()는 동일 값 — 두 스탬프를 인라인으로 찍어도 안전", async () => {
  const { getDefaultDb } = await import("./client");
  const { sql } = await import("drizzle-orm");
  const [row] = await getDefaultDb().execute<{ same: boolean }>(
    sql`select (now() = now()) as same`,
  );
  expect(row.same).toBe(true);
});

test("updated_at은 DB 시계(sql`now()`)로만 찍는다 — 앱 new Date() 금지", async () => {
  const hits: string[] = [];
  for (const root of SCAN_ROOTS) {
    for await (const rel of new Glob("**/*.ts").scan({ cwd: root, onlyFiles: true })) {
      const path = `${root}/${rel}`;
      if (path === SELF) continue;
      if (path.endsWith(".test.ts")) continue; // 테스트는 픽스처로 임의 시각을 심을 수 있다(의도)
      if (ALLOW.some((a) => a.file === path)) continue;
      const src = stripComments(await Bun.file(path).text());
      for (const m of src.matchAll(RE)) {
        const line = src.slice(0, m.index).split("\n").length;
        hits.push(`${path}:${line} — ${m[0].trim()}`);
      }
    }
  }
  expect(hits).toEqual([]);
});

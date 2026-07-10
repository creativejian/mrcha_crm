import { sql } from "drizzle-orm";

import type { Db, Executor } from "../db/client";

// 운영 알림 트리거가 달린 public 테이블에 쓰는 테스트용 가드.
//
// 배경(2026-07-09 사고): `DATABASE_URL`이 공유 master를 가리키는데, 아래 네 트리거가 `net.http_post`로
// 운영 Edge Function을 호출한다. 테스트가 행을 지우고 끝나도 트리거는 이미 발화한 뒤라, 로컬
// `bun run test:server` 한 번이 운영 디스코드 알림과 관리자 단말 FCM 푸시를 실제로 냈다(42건).
//
//   handle_new_consultation      · public.consultations   → 디스코드 관리자 알림
//   notify_advisor_quote         · public.advisor_quotes  → 고객 FCM 푸시
//   notify_staff_chat_message    · public.chat_messages   → 고객 FCM 푸시
//   notify_chat_session_assigned · public.chat_sessions   → 상담사 FCM 푸시
//
// 앱 팀이 네 트리거에 아래 가드를 배포했다(마이그레이션 20260709103000_skip_notify_guard.sql).
//
//   IF current_setting('app.skip_notify', true) = 'on' AND session_user = 'postgres' THEN
//     RETURN NEW;
//   END IF;
//
// INSERT/UPDATE 자체는 그대로 수행되고 알림만 건너뛴다. 주의점 셋:
//
//  1. 값은 정확히 소문자 `'on'`이어야 한다(엄격 비교 — `'ON'`/`'true'`는 인정되지 않는다).
//  2. `set_config(..., true)`는 SET LOCAL이라 **트랜잭션 안에서만** 유효하다. `db.insert()` 단독
//     호출은 자동커밋이라 걸리지 않으므로 반드시 이 헬퍼로 감싸야 한다.
//  3. `session_user`가 `postgres`여야 한다. CRM 커넥션은 pooler를 경유해도, SECURITY DEFINER 함수
//     내부에서도 `postgres`로 유지된다(실측). 앱 유저(`authenticator`)는 이 가드를 못 쓴다 —
//     커스텀 GUC엔 권한 검사가 없어서 진짜 알림이 묻히는 것을 막기 위한 조건이다.
//
// `application_name` 방식은 불가능하다 — Supavisor pooler가 값을 자기 이름으로 덮어쓴다(실측).
// 세션 레벨 `SET`(is_local 없이)도 쓰지 않는다 — transaction pooler(6543)는 백엔드를 다른 커넥션에
// 재사용하므로, GUC가 남은 백엔드를 다른 `postgres` 커넥션(dev 서버·백필)이 잡으면 **진짜 알림이
// 조용히 묻힌다**. 트랜잭션 스코프(SET LOCAL)만 안전하다.
//
// 라우트 테스트(`app.request()`)는 이 헬퍼로 감쌀 수 없다 — 라우트가 **자기 트랜잭션**
// (`c.var.db.transaction()`)을 열기 때문에 바깥에서 연 트랜잭션과 무관하다. 대신 `guardedDb`(아래)로
// 라우트가 집는 db 자체를 바꾼다.
//
// ⚠️ 과거 이 자리에 "app.request()는 dbMiddleware가 별도 커넥션을 열어 트랜잭션을 공유하지 못한다"고
// 적혀 있었으나 **사실이 아니다**. 테스트 환경엔 `c.env.HYPERDRIVE`가 없어 `dbMiddleware`의
// `!connStr` 브랜치가 타고, 라우트도 테스트도 같은 `getDefaultDb()` 싱글톤을 쓴다. 진짜 봉쇄는
// 커넥션이 아니라 "라우트가 여는 트랜잭션에 SET LOCAL을 주입할 seam이 없다"는 것이었다(→ setTestDb).
export async function withNotifyGuard<T>(db: Db, fn: (tx: Executor) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.skip_notify', 'on', true)`);
    return fn(tx);
  });
}

// 라우트 통합 테스트용 — 감싼 db가 여는 **모든 트랜잭션**의 첫 문장에서 가드 GUC를 켠다.
// `withNotifyGuard`와 같은 SET LOCAL(트랜잭션 스코프)이라 "세션 레벨 SET 금지" 함정에 걸리지 않는다.
//
// 쓰는 법: `setTestDb(guardedDb(getDefaultDb()))` (`src/middleware/db.ts`) → 그 파일의 `app.request()`
// 라우트들이 여는 트랜잭션이 전부 가드된다. `afterAll(() => setTestDb(null))`로 반드시 되돌릴 것.
//
// 한계: 데코레이터는 `db.transaction()` 경로만 커버한다. autocommit 단발 쿼리(`db.insert()` 등)는
// SET LOCAL이 걸리지 않으므로, 알림 테이블에 그렇게 쓰는 테스트는 여전히 `withNotifyGuard`가 필요하다.
// (문제의 발송 경로 `routes/customers.ts` PATCH → updateQuote → syncAdvisorQuoteOnSend는 트랜잭션이다.)
//
// 구현: Proxy get 트랩. 메서드는 원본에 bind해 `this`가 프록시로 새지 않게 한다(drizzle 내부가
// `this.session`/`this.dialect`를 읽는다).
export function guardedDb(db: Db): Db {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "transaction") return guardedTransaction(target);
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

function guardedTransaction(db: Db): Db["transaction"] {
  const wrapped = <T>(fn: (tx: Executor) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.skip_notify', 'on', true)`);
      return fn(tx);
    });
  return wrapped as Db["transaction"];
}

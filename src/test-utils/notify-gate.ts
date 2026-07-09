import { test } from "bun:test";
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
//
// 라우트 테스트(`app.request()`)는 dbMiddleware가 별도 커넥션을 열어 이 트랜잭션을 공유하지 못한다.
// 그 경로는 여전히 알림이 나가므로 `notifyTriggerTest`로 skip한다.
export async function withNotifyGuard<T>(db: Db, fn: (tx: Executor) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.skip_notify', 'on', true)`);
    return fn(tx);
  });
}

// 프로덕션 라우트 경로를 태워서 알림 테이블에 쓰는 테스트(= 트랜잭션을 공유할 수 없는 것)만 남는 게이트.
// `NOTIFY_TRIGGER_TESTS=on`(= `bun run test:server:notify`)으로만 실행되며, 켜면 실제 알림이 나간다.
export const notifyTriggerTestsEnabled = process.env.NOTIFY_TRIGGER_TESTS === "on";

if (notifyTriggerTestsEnabled) {
  console.warn(
    "\n⚠️  NOTIFY_TRIGGER_TESTS=on — 라우트 경유 쓰기는 트랜잭션 가드 밖이라 실제 알림/푸시가 발송됩니다.\n",
  );
}

export const notifyTriggerTest = notifyTriggerTestsEnabled ? test : test.skip;

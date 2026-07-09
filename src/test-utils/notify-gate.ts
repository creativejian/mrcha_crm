import { test } from "bun:test";

// 운영 알림 트리거가 달린 public 테이블에 쓰는 테스트의 게이트(기본 OFF).
//
// 배경(2026-07-09 사고): `DATABASE_URL`이 공유 master를 가리키는데, `public.consultations`(트리거
// `on_consultation_created`)와 `public.advisor_quotes`(트리거 `on_advisor_quote_sent`)에는 AFTER
// INSERT/UPDATE 트리거가 걸려 있다. 트리거가 `net.http_post`로 운영 Edge Function(notify-admin ·
// send-push)을 호출하므로, 로컬 `bun run test:server` 한 번이 운영 디스코드 알림 42건과 관리자
// 단말 FCM 푸시를 실제로 발송한다. 테스트가 행을 지우고 끝나도 트리거는 이미 발화한 뒤다.
//
// `test:server`의 `PUSH_NOTIFY=off`는 이걸 못 막는다 — 그건 CRM 앱 코드의 배정 푸시 경로
// (`src/lib/push-notify.ts`) 게이트일 뿐이고, Postgres 트리거는 프로세스 환경변수를 볼 수 없다.
//
// 임시 조치다. 앱 팀이 세 트리거(handle_new_consultation · notify_advisor_quote ·
// notify_staff_chat_message)에 아래 가드를 배포 중이다.
//
//   IF current_setting('app.skip_notify', true) = 'on' AND session_user = 'postgres' THEN
//     RETURN NEW;
//   END IF;
//
// 가드가 배포되면: 픽스처를 `db.transaction()`으로 감싸고 첫 문장에서
// `set_config('app.skip_notify','on',true)`를 건 뒤 이 게이트를 제거해 테스트를 기본 스위트로
// 되돌린다. `db.insert()` 단독 호출은 자동커밋이라 `SET LOCAL`이 걸리지 않으니 트랜잭션 래핑이
// 필수다. 라우트 테스트(`app.request()`)는 dbMiddleware가 별도 커넥션을 열어 테스트 트랜잭션을
// 공유하지 못하므로, 그 경로는 프로덕션 코드 쪽에서 GUC를 주입해야 한다(별도 작업).
//
// 실측 확인(2026-07-09): CRM 커넥션의 `session_user`는 `postgres`이고(pooler 경유·SECURITY DEFINER
// 내부에서도 유지), `set_config(...,true)`는 트랜잭션 종료 시 누수 없이 사라진다.
// `application_name`은 Supavisor가 덮어써 트리거까지 도달하지 않는다(그래서 GUC 방식).
//
// ⚠️ 게이트를 켜면 운영 디스코드 알림과 관리자 단말 FCM 푸시가 **실제로 발송된다**.
// 가드 배포 전까지는 켜지 말 것. (2026-07-09에 `NOTIFY_TRIGGER_TESTS=on`으로 한 파일만 돌렸다가
// 상담 알림 15건을 또 냈다 — 환경변수만 주면 뚫리므로 아래 경고를 반드시 남긴다.)
export const notifyTriggerTestsEnabled = process.env.NOTIFY_TRIGGER_TESTS === "on";

if (notifyTriggerTestsEnabled) {
  console.warn(
    "\n⚠️  NOTIFY_TRIGGER_TESTS=on — public.consultations / public.advisor_quotes 에 실제로 INSERT합니다.\n" +
    "   DB 트리거가 운영 디스코드 알림과 FCM 푸시를 발송합니다. 의도한 것이 아니면 즉시 중단하세요.\n",
  );
}

// 알림 트리거 테이블에 INSERT/UPDATE 하는 테스트는 `test` 대신 이걸 쓴다.
export const notifyTriggerTest = notifyTriggerTestsEnabled ? test : test.skip;

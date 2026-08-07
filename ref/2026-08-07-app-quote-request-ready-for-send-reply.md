# [차선생 CRM → 앱 팀] 빠른견적 4단계 `ready_for_send_at` 배선 회신

작성 2026-08-07 · 요청자: 이사님 · CRM 담당: 영실

> 상태: CRM 구현 후보 완료. **앱의 DB migration과 send-push consumer가 먼저 배포된 뒤에만 CRM을 배포한다.**

## 확정 계약

- 1단계 `견적 요청 완료`: 요청 생성 — CRM 변경 없음.
- 2단계 `담당자 확인 완료`: 기존 `openWorkbenchForQuoteRequest` → `confirmQuoteRequest` 배선을 그대로 유지한다.
  `confirmed_at IS NULL` 최초 전이와 기존 푸시 payload(차량명 포함)도 바꾸지 않는다.
- 3단계 `발송 준비 중`: 실제 워크벤치 `작성 완료`(`persistWorkbenchQuote({ send: false })`) 성공 사건이다.
  신규 견적 INSERT와 기존 견적 PATCH 모두 `markReadyForSend: true` command를 싣는다.
- 4단계 `견적 도착`: 기존 상담사 견적 등록·발송 배선을 그대로 유지한다.

## CRM 구현 경계

서버는 `markReadyForSend`를 일반 견적 컬럼과 분리한 command로 받는다. 견적 저장이 성공한 뒤 같은
DB 트랜잭션 안에서 저장된 `crm.quotes.source_quote_request_id`를 다시 읽고, 요청 소유권
(`quote_requests.user_id == customers.app_user_id`)을 확인한 다음 아래 조건부 UPDATE를 수행한다.

```sql
UPDATE public.quote_requests
SET ready_for_send_at = now()
WHERE id = :source_quote_request_id
  AND ready_for_send_at IS NULL;
```

- UPDATE 1행 = 최초 전이. 트랜잭션 커밋 후 푸시를 예약한다.
- UPDATE 0행 = 재클릭·재시도·새로고침. 값과 푸시 모두 no-op이다.
- 견적 저장이 실패하거나 트랜잭션이 롤백되면 `ready_for_send_at`도 함께 롤백된다.
- 출처 요청이 없는 일반 CRM 견적과 소유권이 어긋난 loose id는 no-op이다.
- 고객 앱 `발송`(`send: true`)은 `markReadyForSend`를 싣지 않는다. 작성 완료와 발송 사건을 섞지 않는다.

## 푸시 계약

최초 전이에서 CRM은 앱 `send-push`에 아래 내부 라우팅 payload만 전달한다.

```json
{
  "user_id": "<수신자>",
  "tag": "quote-request-ready-for-send"
}
```

CRM caller는 title/body/subtitle을 만들지 않는다. 앱 consumer가 사건 tag를 아래 승인 문구로 변환한다.

> 보내드릴 견적 조건을 마지막으로 확인하고 있어요. 곧 견적서를 보내드릴게요.

직접 식별정보(고객명·전화번호·이메일·session 식별자·비공개 상담본문)는 FCM 표시/data payload에 싣지
않는다. 차량명·구매방식·가격을 개인정보로 분류하지 않으며, 이번 변경에서 기존 2단계 표시 계약을
축소하거나 바꾸지 않는다.

## 배포 게이트

1. 앱 저장소 migration으로 nullable `public.quote_requests.ready_for_send_at` 배포
2. 앱 `send-push`의 `quote-request-ready-for-send` tag 고정 문구 consumer 배포
3. 위 두 항목의 운영 반영 확인
4. CRM 배포

CRM 저장소는 public schema migration을 만들거나 배포하지 않는다. 선행 배포 전에는 DB 의존 멱등·롤백
통합 테스트와 CRM 운영 배포를 완료로 판정하지 않는다.

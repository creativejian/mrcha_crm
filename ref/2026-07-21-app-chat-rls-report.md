# [CRM → 앱 팀] `public.chat_messages` INSERT 정책 — 컬럼 값 미검증 (낮은 우선순위)

작성 2026-07-21 · CRM 실시간 상담 콘솔 권한 감사 중 발견 · **급하지 않습니다**

## 요약

`chat_messages` INSERT 정책이 **호출자의 role만 확인하고, 넣는 행의 컬럼 값은 검증하지 않습니다.** staff 계정이 다른 상담원 이름으로 보내거나 고객 발화를 위조하는 게 정책상 가능합니다.

내부 직원 계정이 전제라 외부 공격은 아니고, 저희 CRM 코드는 정상 값만 보냅니다. **지금 당장 문제가 되고 있다는 보고는 없습니다** — 다만 그쪽 소유 테이블이라 알려드립니다.

## 실측 (2026-07-21)

```sql
-- policyname: "Staff can insert messages"
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
            AND profiles.role = ANY (ARRAY['staff','manager','admin']::user_role[]))
)
```

조건이 이것뿐이라 `user_id`·`staff_id`·`is_user`·`sender_type`은 어떤 값이든 통과합니다.

원리적으로 가능한 것:

| 조작 | 결과 |
|---|---|
| `staff_id`를 타 상담원 id로 | 그 사람이 보낸 것으로 표시 |
| `is_user: true` | 고객이 보낸 것처럼 위조 |
| `user_id`를 임의 고객으로 | 담당이 아닌 고객 대화에 메시지 삽입 |

**실제 INSERT는 하지 않았습니다.** 이 테이블은 `notify_staff_chat_message` 트리거로 고객에게 FCM 푸시를 쏘기 때문에, 확증 이득보다 실수 위험이 크다고 판단했습니다. 정책 정의만으로 충분히 명확합니다.

## 참고 — 잘 되어 있는 부분

같이 확인했는데 이쪽은 문제가 없었습니다:

- **`dealer` role이 채팅 정책 전체에서 빠져 있습니다.** `user_role` enum엔 dealer가 있는데 `chat_sessions`·`chat_messages` 정책 배열은 staff·manager·admin뿐이라, dealer는 조회조차 안 됩니다. 저희 쪽 전역 딜러 쓰기 차단(CRM 서버 미들웨어)은 supabase 직결 경로에 **원리적으로 닿지 않는데**, RLS가 대신 막아주고 있었습니다.
- `chat_sessions` UPDATE가 staff 전체에 열린 건 저희 콘솔 흐름(대기 큐에서 세션을 주고받음)상 의도로 이해했습니다.

## 제안 (그쪽 판단)

우선순위는 그쪽에서 정해 주세요. 굳이 손본다면 WITH CHECK에 컬럼 조건을 얹는 정도로 보입니다:

```sql
-- 예시일 뿐입니다 — 앱 쪽 사용 패턴을 저희가 다 알지 못합니다
AND is_user = false
AND staff_id = auth.uid()
AND sender_type IN ('staff','system')
```

⚠️ 다만 **CRM이 `sender_type='system'` 메시지를 넣을 때 `staff_id`를 채우지 않습니다**(상담원 인수/AI 반환 안내). 위 예시를 그대로 적용하면 그 경로가 막히니, 실제 조건은 양쪽 사용 패턴을 맞춰봐야 합니다. 진행하시게 되면 저희 쪽 INSERT 형태를 정리해 드리겠습니다.

## CRM 쪽 사용 형태 (참고)

| 함수 | sender_type | is_user | staff_id |
|---|---|---|---|
| `sendStaffMessage` | `staff` | false | 로그인 상담사 |
| `insertSystemMessage`(인수/반환 안내) | `system` | false | **없음** |

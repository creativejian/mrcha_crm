# 앱 팀 Security Advisor 공유 — CRM 회신 (2026-07-22)

앱 팀 메시지: "Advisor 경고 6건은 전부 의도된 상태 · `update_human_handoff_settings` 호출 방식 변경 금지 요청 · CRM이 authenticated 세션으로 호출 중인지 확인 요청".

## 1. 확인 요청 답변 — **네, 관리자 로그인 세션(authenticated)으로 호출 중입니다** ✅

실측 근거(2026-07-22, 코드 전수):

| 확인 항목 | 결과 | 근거 |
|---|---|---|
| 호출 위치 | **브라우저 클라이언트 단일 경로** | `client/src/lib/handoff-settings.ts:166` `supabase.rpc("update_human_handoff_settings", …)` |
| 사용 키 | **publishable(anon) 키 + 로그인 사용자 세션** | `client/src/lib/supabase.ts:12` `createClient(url, publishableKey)` — secret/service_role 키는 클라 번들에 존재하지 않음 |
| 서버(secret key) 호출 | **0건** | `grep -rn "update_human_handoff" src/` → 결과 없음. CRM 서버는 이 RPC를 쓰지 않는다 |
| admin 게이트 통과 경로 | 42501을 실제로 받아 처리 | `handoff-settings.ts:176` `if (error.code === "42501") throw new Error("최고관리자만 …")` — 함수 내부 게이트를 타고 있다는 증거 |
| 화면 게이트 | 라우트 admin 전용(이중) | `client/src/App.tsx:378` `isAdmin ? <HandoffOperationPage/> : <Navigate to="/" replace/>` |

즉 앱 팀이 추정하신 대로입니다. **service_role 전환 계획 없고, 그 경로 자체가 코드에 없습니다.**

부기: 화면 주석(`HandoffOperationPage.tsx:23`)에 이미 *"라우트가 admin 게이트지만 RPC가 최종 fail-closed(42501→403)라 화면은 표면화만 담당한다"* 로 같은 인식이 박혀 있습니다.

## 2. 요청 사항 수용

1. **계약 프리즈 수용** — `update_human_handoff_settings`의 호출 방식·시그니처·게이트 로직을 CRM에서 변경하지 않습니다. Advisor 경고(lint 0029)를 이유로 손대지 않습니다.
2. **baseline 수용** — Warnings 4 / Info 2는 정상 기준선으로 관리합니다. 초과 시에만 조사.
3. **스키마 변경 시 양팀 동기화** — `human_handoff_settings` 관련 변경이 필요해지면 먼저 공유드립니다.

## 3. CRM 쪽에서 짚어둘 것 (계약 정밀화 요청 1건)

**`p_timezone`을 넘기지 않고 DB 기본값(`'Asia/Seoul'`)에 의존하고 있습니다** (`handoff-settings.ts:166-172` — `p_mode`·`p_schedule`·`p_force_message`·`p_outside_hours_message`·`p_reason` 5개만 전달).

→ 앱 팀이 그 **DEFAULT 값을 바꾸면 CRM 저장 동작이 조용히 따라 바뀝니다**(우리 코드 변경 0으로). 시그니처 프리즈 대상에 **기본값도 포함**해 주시고, 변경이 필요하면 사전 공유 부탁드립니다. (CRM에서 명시 전달로 바꾸는 것도 가능하니 그쪽이 낫다면 알려주세요.)

## 4. 역방향 공유 — 임베딩 모델 `gemini-embedding-001` shutdown → **✅ 앱 팀 해결 완료(2026-07-22 확인, 전달 불필요)**

> 아래는 CRM 이관 기록으로만 남긴다. **앱 쪽도 같은 날 이관 완료(2026-07-22 확인)라 이 절을 앱 팀에 전달하지 않는다.**
> 결과적으로 **두 팀의 임베딩 공간은 다시 일치**한다. 다만 CRM은 `crm.embeddings`만 읽으므로 교차 참조 지점은 여전히 없고,
> 앞으로 앱 임베딩을 참조하는 기능을 만든다면 **그 시점에 양쪽 모델 일치를 먼저 확인**해야 한다
> (차원이 3072로 같아 겉보기엔 정상인데 유사도만 무작위가 되므로 증상으로 알아채기 어렵다).

- CRM은 오늘 `gemini-embedding-001` → **`gemini-embedding-2`** 로 이관했습니다(#312·#313).
- **차원은 3072로 동일해 스키마 변경이 없지만, 벡터 공간은 호환되지 않습니다** — 같은 문장을 두 모델로 임베딩해 코사인을 재면 **0.03**(거의 직교, 실측). 즉 **모델을 바꾸면 기존 임베딩을 전량 재생성해야 하고**, 섞이면 검색이 에러 없이 조용히 죽습니다.
- 실측 함정 2가지: ①`gemini-embedding-2`는 `taskType`을 **조용히 무시**합니다(DOCUMENT/QUERY/생략 결과가 코사인 1.0으로 동일 — 001은 0.911로 실제 구분했습니다) ②유사도 임계값을 재실측해야 합니다. CRM은 구 임계값(0.75)을 그대로 뒀더니 **관련 질문 8종 중 5종이 "근거 없음"** 으로 떨어졌고, 0.60으로 조정했습니다.
- 앱이 아직 001을 쓰신다면 shutdown 일정 확인을 권합니다. **CRM은 `crm.embeddings`만 읽으므로 두 팀 벡터가 섞이는 지점은 없습니다** — 앱 쪽 독립 판단으로 진행하셔도 됩니다.

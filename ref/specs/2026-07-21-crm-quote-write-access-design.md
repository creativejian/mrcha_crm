# 견적 쓰기 권한 — 담당자 스코프 게이트 (2026-07-21)

상태: 이사님 회신 확정(2026-07-21 A-3 세부 결정 — D-1 ① / D-2 ① / D-3 ① / D-4 ②). 질의·선택지 원문은 `ref/director-pending-confirmations.md` 🟠 항목(종결 시 확인 완료 표로 이동).

## 1. 결정 (정책 SSOT)

> 원칙(이사님): "staff는 본인 담당만 보는(볼) 전제 안에서는 삭제까지 자유" — 위험은 남의 고객 견적을 건드리는 것이지, 자기 고객 견적을 지우는 게 아니다.

| 역할 | 견적 쓰기(생성·수정·발송·결정 마킹·삭제·원본 첨부/삭제) |
|---|---|
| admin | 모든 고객 (D-2 ①) |
| manager(팀장) | 모든 고객 (D-2 ① — 팀 개념 없음 확정이라 "자기 팀만"은 불가, 팀 모델 생기면 재론) |
| staff(상담사) | **본인 담당(`customers.advisor_id` = 본인 uuid) 고객만**. 발송완료 견적 삭제도 가능 — 경고 확인창 유지 (D-1 ①) |
| 미배정(advisor_id null) 고객 | admin·manager만 (D-3 ① — 상담사는 본인 배정부터) |
| dealer | 전역 `dealerWriteGate`(#220)가 이미 차단 — 이 게이트에서도 false(이중, fail-closed) |

- **적용 범위 = 견적 쓰기 전반**(D-4 ②): 생성 POST · 수정/발송/결정 마킹/대표 시나리오 PATCH · 삭제 DELETE · 원본 첨부 POST · 원본 삭제 DELETE — 5개 라우트 전부. **읽기는 제한 없음**(견적함 열람·원본 보기·미리보기 URL 그대로).
- 발송완료 구분 없음(D-1 ① — `appStatus` 미참조), 담당자 판정 = `advisor_id`(uuid)만(이름 비교 금지 — #176 정합 규칙이 스테일 id를 이미 차단).

## 2. 구현

### 2.1 정책 헬퍼 1벌 (물리 공유)

`client/src/lib/quote-write-access.ts` — 부작용 0 순수. **서버→클라 순수 모듈 import 경계 허용 목록에 추가**(AGENTS.md 갱신 동반 — app-card-labels 선례).

```ts
canWriteQuote(user: { id: string; role: string }, customerAdvisorId: string | null): boolean
// admin·manager → true / staff → advisorId 일치(null이면 false) / 그 외(dealer 등) → false
```

서버 게이트·클라 버튼 숨김이 같은 판정을 공유한다(파리티 테스트 불요 — 물리 1벌).

### 2.2 서버 (진짜 게이트)

- 신규 쿼리 `getCustomerAdvisorId(id)` → `{ advisorId } | null`.
- `src/routes/customers.ts` 견적 쓰기 라우트 5곳 상단에 게이트: 고객 미존재 404 → `canWriteQuote` 실패 403 `"담당 고객의 견적만 처리할 수 있습니다."` → 통과 시 기존 로직. 부수효과(임베딩 스케줄·Storage) 전부 게이트 뒤 — 403은 어떤 변이도 남기지 않는다.
- 체인 순서 유지: auth(401) → dealerWriteGate(403) → 이 게이트(403) → 404/본 처리.
  ⚠️개정(같은 날 #301 role scope spec S-7, 배치 12 C#2 각주): customerScopeGate가 staff 타 담당·미배정을 **404(존재 비노출)로 선행 차단**한다 — 아래 "staff 403" 서술들은 이 게이트 단독 기준이고, 실응답은 404다. 이 게이트의 403은 안쪽 그물로 잔존(스코프 게이트 회귀 시 403≠404로 테스트가 잡는다).

### 2.3 클라 (UX 보조 — 서버가 진짜 게이트)

- `AuthProvider`에 `userId`(session.user.id)·`roleClaim`(raw claim — roleTab과 별개, 헬퍼 입력용) 추가.
- `CustomerDetailPage`(DetailContent)에서 `quoteWritable = canWriteQuote({ id: userId, role: roleClaim }, workflow.advisorId)` 파생 — `workflow.advisorId`는 배정 저장 낙관 갱신을 반영하므로 "본인 배정 → 즉시 견적 작성"이 리로드 없이 성립.
- `quoteWritable === false`면 숨김: 견적함 신규(+)·행 액션 팝오버의 쓰기 항목(앱 발송·견적 수정·원본 첨부·최종 고민중·고객 확정·계약 진행·삭제 — 원본 보기는 잔류)·행 파일 드롭 첨부·니즈 카드 견적 작성/추가 작성 진입점.

## 3. 범위 밖 (박제)

- **목록/상세 화면 role scope**(staff에게 남의 고객 자체를 숨기기): 기존 대기 항목 그대로 별도 슬라이스 — 이 게이트가 선행돼 "보여도 못 건드리는" 상태를 먼저 확보.
- **메모·할일·서류 등 타 도메인 쓰기 매트릭스**(D-4 ③): 기각 — 필요 시 별도 브레인스토밍(이사님 일정 답변 대기 항목 아님, 이번 회신에서 미선택).
- 견적 읽기 제한·발송완료 삭제의 추가 확인 절차(D-1 ② 기각 — 재제안 금지, 근거: 상단 원칙).

## 4. 테스트·검증

- 순수 헬퍼 유닛: 역할×담당 매트릭스 전분기(admin/manager/staff 일치·불일치·미배정/dealer/미지 역할).
- 서버(실 master, `CU-QWACC-` 접두사 — registry 선등록 #214): staff 타인 고객 PATCH/DELETE/POST 403 + **변이 없음 검증**(403 후 행 불변) / staff 본인 담당 200 / admin·manager 전체 200 / 미배정 고객 staff 403 / 원본 라우트 403. RED 실관찰 후 게이트 구현.
- 클라: 게이트 파생·숨김은 헬퍼 유닛이 정책을 잠그고, 표면은 유슨생 실기(admin은 현행 그대로·staff 실계정 부재라 크로스 실기는 화면 scope 슬라이스와 함께).
- `typecheck`/`lint` 0 · `test:unit` · `test:server` · `build`.

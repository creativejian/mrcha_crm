# MC 마스터 변경 승인 워크플로 설계 (2026-07-30)

요청: 이사님(팀장 수정·추가 개방, 반영은 관리자 최종 컨펌) · 설계 합의: 유슨생 · 작성: 유슨생 세션

## 1. 요구 (원문 기준)

- MC 마스터(차량 카탈로그)를 **팀장(manager)도 수정·추가**할 수 있게 한다.
- ⚠️ **팀장이 저장해도 catalog에 바로 반영되면 안 된다** — 관리자(admin)가 **최종 컨펌해야 반영**.
- **상담사(staff)는 제외** — 지금처럼 읽기 전용 유지 (2026-07-30 유슨생 확정).
- **삭제는 팀장도 불가** — admin 전용 유지 (2026-07-30 유슨생 확정).
- **mc_code 부여는 당연히 불가** — admin 전용 유지 (2026-07-30 유슨생 확정).
- 딜러 할인 제안과 달리 **같은 대상에 여러 사람의 제안이 병존할 이유가 없다** — 한 명이 올리면
  그 대상은 "처리 중"이고, 다른 사람이 또 올릴 필요가 없다 (2026-07-30 유슨생 확정).

## 2. 핵심 결정 — 범용 변경 요청 큐 (딜러 제안 패턴의 일반화)

```
팀장 편집(기존 UI 그대로)          관리자 승인                      최종 소비
crm.catalog_change_requests  →  [승인 시 replay 실행]  →  catalog.*  →  견적 워크벤치 · 차선생 앱
(대상+작업당 pending 1건)          같은 실행 함수 재생 + 감사
```

- **팀장은 catalog 스키마를 한 글자도 건드리지 않는다.** 팀장의 쓰기는 전부 crm 스키마의
  변경 요청 행으로만 남고, catalog 반영은 관리자 승인이라는 별도 행위로만 일어난다 —
  딜러 할인 제안(`ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md`)과 같은 의미론.
- 딜러 방식(도메인별 강타입 제안 테이블)을 복제하지 않고 **범용 큐 테이블 1개**로 받는 이유:
  승인 대상이 8종(모델/트림/옵션 × 추가/수정 + 무옵션 토글)이라 도메인별 테이블이면
  테이블·라우트·UI가 그 수만큼 늘고, 추가/수정은 "필드 제안" 모양에 맞지 않는다.
  규칙이 "전 쓰기 컨펌" 하나이므로 메커니즘도 하나가 맞다.
- **부수 효과 — 기존 구멍 봉인**: 종래 `/api/catalog/*` 쓰기 라우트에는 role 게이트가 없어
  상담사도 API 직접 호출로 catalog에 쓸 수 있었다(UI만 admin 제한). 이번에 전 쓰기 라우트에
  `requireRoles`를 명시 부착해 이 구멍이 닫힌다(§6.2). 유슨생 현장 승인 — 등재 불요.

### 2.1 기각한 대안

- **도메인별 제안 테이블 확장(딜러 방식 복제)**: 위 서술 — 범위가 넓어 과함. 할인 3필드처럼
  좁은 범위였다면 이쪽이 정답이었다.
- **catalog에 draft 상태 추가**: catalog는 앱과 공유하는 master 스키마 — draft 행/컬럼이
  앱 고객에게 새는 순간 끝. 대기 상태는 반드시 crm 스키마에만 산다.
- **즉시 반영 + 사후 승인(되돌리기)**: "반영은 안 되고"라는 요구와 정면 충돌.

## 3. 승인 대상 인벤토리 (catalog 쓰기 17종 전수 분류)

### 3.1 큐 대상 8종 — 팀장 요청 가능 (admin은 즉시 실행)

| kind | 원 라우트 | target_type | 비고 |
|---|---|---|---|
| `model.create` | POST /models | model (target_id NULL) | |
| `model.update` | PATCH /models/:id | model | category·status(단종 포함) |
| `trim.create` | POST /trims | trim (target_id NULL) | |
| `trim.update` | PATCH /trims/:id | trim | ~~할인 3필드 포함~~ **할인 3필드는 팀장 제안에서 제외**(2026-07-31 유슨생 정정 — 확정 할인은 딜러 제안→관리자 채택 체계 소유. 서버가 202 적재 시 payload에서 제거해 ①폼 오픈 시점 구 할인값이 승인 replay로 채택값을 되돌리는 사고 ②채택발 드리프트 409 간섭을 차단. 팀장 폼도 할인 섹션 숨김. admin 직접 PATCH는 계속 포함 — 그 경로의 `recordAdminDiscountEdits` 감사는 현행 유지) |
| `option.create` | POST /trims/:id/options | option (target_id NULL, trim은 payload) | |
| `option.update` | PATCH /options/:id | option | |
| `trim.no-option.set` | POST /trims/:id/no-option | trim | 무옵션 확정 |
| `trim.no-option.unset` | DELETE /trims/:id/no-option | trim | HTTP DELETE지만 의미는 토글 해제 — 삭제 아님 |

### 3.2 admin 전용 유지 9종 — 팀장 큐에도 못 올림 (UI에서 숨김)

- **삭제 3종**: DELETE /models/:id · /trims/:id · /options/:id
- **`POST /models/:id/assign-codes`** — mc_code 부여
- **`POST /trims/move`** — 트림 모델 이동. 이동해도 mc_code가 안 바뀌어(트리거가 변경 차단)
  코드와 실제 모델이 어긋나는 stale을 남기는 구조 변경이라 삭제와 같은 급으로 분류
  (2026-07-30 유슨생 확정).
- **reorder 2종**: POST /models/reorder · /trims/reorder — ids 배열 스냅샷은 드리프트가
  너무 잘 나고(그 사이 행 추가/삭제 = 무조건 무효) "드래그했는데 승인 대기"는 UX도 이상하다.
  팀장에겐 드래그 핸들 자체를 숨긴다.
- **딜러 제안 채택 2종**: POST /trims/:id/discount-adoptions · …/undo (이미 admin 전용)

### 3.3 역할 매트릭스 (결과)

| | admin | manager | staff | dealer |
|---|---|---|---|---|
| catalog 읽기 | ✅ | ✅ | ✅ | 자기 브랜드(기존) |
| 큐 8종 | 즉시 실행 | **202 큐 적재** | 403 | 403 |
| admin 전용 9종 | 즉시 실행 | 403 | 403 | 403 |
| 승인/반려 | ✅ | 403 | 403 | 403 |

## 4. 데이터 모델 — 신설 `crm.catalog_change_requests` (마이그 0043)

```
id            uuid PK default gen_random_uuid()
kind          text NOT NULL      — §3.1의 8종 CHECK
target_type   text NOT NULL      — 'model' | 'trim' | 'option' CHECK (kind에서 파생·명시 저장)
target_id     bigint             — update·토글 대상 id (create는 NULL). → catalog.*(loose id 관례)
payload       jsonb NOT NULL     — 원 라우트 zod 검증을 통과한 body 그대로
snapshot      jsonb              — 요청 시점 현재 값 (update/토글: 대상 행 관련 필드 · create: NULL)
status        text NOT NULL default 'pending' — 'pending'|'approved'|'rejected'|'canceled' CHECK
requested_by  uuid NOT NULL      — → public.profiles.id (loose id 관례)
reject_reason text               — 반려 사유 (반려 시 필수, §6.3)
decided_by    uuid               — 승인/반려한 관리자
decided_at    timestamptz
created_at    timestamptz NOT NULL default now()
updated_at    timestamptz NOT NULL default now()  — UPDATE는 sql`now()` (DB 시계 관례 #334)
```

### 4.1 대상+작업당 pending 1건 — 부분 UNIQUE

```sql
CREATE UNIQUE INDEX catalog_change_requests_pending_target_unique
  ON crm.catalog_change_requests (target_type, target_id, kind)
  WHERE status = 'pending' AND target_id IS NOT NULL;
```

- **딜러 제안과 반대 방향의 의도적 결정**: 딜러는 경쟁 견적이라 트림당 여러 딜러 제안이
  병존해야 했지만, 이건 내부 업무 분담 — 같은 대상을 두 명이 고칠 이유가 없다.
- **kind를 UNIQUE 축에 넣는 이유**: 같은 트림에 `trim.update`(가격 수정)와
  `trim.no-option.set`(무옵션 확정)은 다른 작업이라 공존해야 한다. 막을 것은
  "같은 대상에 같은 작업"의 중복뿐.
- **충돌 시 동작(§6.1)**: 본인 재제출 = 자기 pending 갱신(payload·snapshot 교체 + updated_at
  전진) · 타인 = 409 + 기존 요청자/시각 안내. 승인/반려/취소되면 자리가 다시 열린다.
- create는 target_id NULL이라 UNIQUE 대상 아님(추가 요청은 무제한 — 서로 다른 새 행이므로).
- 이 표는 **대기열이자 감사 기록**을 겸한다 — 요청자·승인자·전값(snapshot)·사유가 전부 남는다.
- catalog(master 스키마)에는 아무것도 추가하지 않는다.

## 5. kind 레지스트리 — 적재와 재생의 단일 소스

`src/db/queries/change-requests.ts`에 kind마다 등록:

```
{ targetType, zod 스키마 참조, buildSnapshot(targetId, payload, db),
  execute(payload, targetId, tx), checkDrift(snapshot, current) }
```

- **admin 직접 실행과 승인 replay가 같은 `execute`를 부른다** — 두 경로가 갈라질 수 없다.
  예: `trim.update`의 execute = 현행 PATCH 핸들러의 트랜잭션 블록 그대로
  (before 읽기 → `updateTrim` → 할인 3필드 감사).
- 드리프트 판정은 DB 무관 순수 함수로 분리 — test:pure에서 돈다.

### 5.1 드리프트 판정 (kind별)

| 축 | 판정 |
|---|---|
| `*.update` | **payload가 건드리는 필드만** snapshot과 비교 — 무관 필드를 admin이 그 사이 고쳤어도 통과 (§4.1 덕에 경쟁자는 admin 직접 수정뿐) |
| `*.create` | 부모 존재 확인 (모델/트림이 그 사이 삭제되면 거부) |
| `no-option` 토글 | 대상 트림 존재 + snapshot의 무옵션/옵션 개수 상태 유지 확인 |
| 공통 | 대상 행이 삭제됐으면 현재 값 조회 실패 = 드리프트 |

어긋나면 승인이 409로 실패하고 **행은 pending 유지** — 관리자가 보고 반려를 판단한다
(자동 반려하지 않는다). 채택 드리프트 fail-closed(#392)와 같은 관례.

## 6. 서버 흐름

### 6.1 쓰기 라우트 분기 — "한 라우트, 두 결말"

큐 대상 8종 라우트는 핸들러 안에서 역할로 갈라진다:

```
admin    → 지금 그대로 즉시 실행 (기존 동작 무변경)
manager  → zod 통과한 payload로 스냅샷 뜨고 큐 적재 → 202 { queued: true, requestId }
           (본인 pending 있으면 갱신 · 타인 pending이면 409 + 요청자/시각)
staff·dealer → 403 (§6.2 게이트)
```

### 6.2 게이트 정리 (구멍 봉인)

- 큐 대상 8종: `requireRoles(["admin", "manager"])` 명시 부착
- admin 전용 9종 중 무게이트였던 7종(삭제 3·move·assign-codes·reorder 2): `requireRoles(["admin"])` 부착
- 이걸로 "상담사가 API 직접 호출로 catalog에 쓰던" 기존 구멍이 문서화된 정책으로 닫힌다.

### 6.3 대기열 라우트 (신설 `src/routes/catalog/change-requests.ts`)

| 라우트 | 권한 | 동작 |
|---|---|---|
| `GET /change-requests?status=pending` | admin | 대기열(요청자·대상 이름 조인) — 배지 N건도 이걸로 |
| `POST /change-requests/:id/approve` | admin | §6.4 |
| `POST /change-requests/:id/reject` | admin | `{ reason }` **필수** → rejected + 사유 저장 |
| `DELETE /change-requests/:id` | 요청자 본인 | 자기 pending만 → canceled |
| `GET /change-requests?mine=1` | manager | 내 요청 목록(반려 사유 확인용) |
| `GET /models/:id/change-requests?status=pending` | admin·manager | 화면 배지용 모델 단위 조회 |

### 6.4 승인 실행 — 트랜잭션 하나로

```
tx {
  ① status='pending' 조건부 UPDATE로 행 전이 선점 (동시 더블클릭 → 한쪽만 통과)
  ② payload를 kind의 zod로 재검증 (배포 사이 스키마 변경 방어 — 실패 시 409)
  ③ 드리프트 검사(§5.1) — 어긋나면 409, 행은 pending 유지
  ④ 레지스트리 execute 재생 — 감사 명의(할인 감사 adoptedBy 등)는 **승인한 관리자**
  ⑤ status='approved', decided_by/decided_at 스탬프 (DB 시계)
}
```

## 7. UI

### 7.1 팀장 — "같은 편집 화면, 다른 결말"

- `canEdit`(admin) 옆에 **`canPropose`**(팀장) 축 신설. 기존 편집 UI(TrimEditPanel·추가
  버튼)를 그대로 노출하되 저장 버튼이 **"승인 요청"**, 성공 시 화면 값은 **바뀌지 않은 채**
  토스트 "승인 요청됨 — 관리자 컨펌 후 반영됩니다".
- 클라 api 헬퍼 한 곳에서 `202 { queued }`를 공통 감지 → 토스트 + 목록 재조회 생략.
  호출부 개별 수술 없음.
- **팀장에게 숨김**: 삭제 버튼 · mc_code 부여 · 드래그 reorder · 트림 모델 이동 ·
  딜러 제안 열람/채택/undo. **상담사·딜러는 현행 그대로**(편집 UI 없음).

### 7.2 "승인 대기" 배지 — 중복 작업 방지 (§4.1의 UX 짝)

- 모델 단위 pending 조회로 해당 트림/옵션 행에 배지 + 호버 시 "OOO님 · N시간 전 · 가격 수정".
- admin·manager에게만 (409를 만나기 전에 시도 자체를 안 하게 하는 예방선).

### 7.3 "내 요청 (N)" — 팀장 셀프서비스

- 헤더 팝오버(딜러 "내 입력 트림" `ProposalTrimsPopover` 선례): pending(취소 버튼) ·
  rejected(반려 사유) · 최근 approved. 반려 확인 → 수정 → 재요청 흐름.

### 7.4 관리자 대기열 — "승인 대기 (N)" 패널

- mc-master 헤더 버튼 → 목록: 요청자 · 시각 · 작업 한글 라벨 · 대상 경로(브랜드›모델›트림) ·
  **전→후 diff**(update는 필드별 전→후 · create는 새 값 요약).
- 항목마다 인라인 [승인] [반려(사유 입력)]. 항목 클릭 → **#393 착지 플래시(`hl`) 재사용**으로
  해당 트림에 점프해 맥락 확인 후 결정.
- 승인 409(드리프트) → 그 항목에 "그 사이 값이 바뀌어 승인 불가 — 반려 후 재요청 안내" 표시.

### 7.5 사이드바 배지

- 관리자가 mc-master에 들어와야만 대기를 아는 건 반쪽 — **사이드바 mc-master 메뉴에 건수
  배지**(`newAppRequestCount` 폴링 선례, admin에게만).
- 브리프 '▶ 다음' 후보였던 딜러 제안 도착 배지는 이 자리에 후속 합산(이번 범위 밖).

## 8. 테스트·검증

- **순수 유닛(test:pure 자동 포함)**: 드리프트 판정 kind별 표(§5.1).
- **라우트 테스트(실 DB, 로컬 test:server)**: 역할 매트릭스(§3.3 전수) · 대상+작업당 pending
  1건(타인 409·본인 갱신) · 승인 replay 실반영 + 할인 감사 승인자 명의 · 드리프트 fail-closed ·
  반려 사유 필수 · 본인 취소 · 동시 승인 한쪽만 통과.
  - 알림 트리거 4테이블과 무관 — notify guard 불요. 픽스처는 catalog.test.ts 관례 +
    registry 선등록.
- **클라(test:unit)**: MCMasterPage role별 노출(팀장=승인 요청·상담사=편집 없음·admin=기존
  그대로) · 202 공통 처리.
- 검증 예산: typecheck · lint · knip · format:check · test:unit · build + 로컬 test:server.
  머지 후 prod 실기 1회(팀장 요청 → admin 승인 → 반영 확인).

## 9. 슬라이스 — PR 3개, 순서가 안전장치

1. **PR 1 (서버)**: 마이그 0043 + kind 레지스트리 + 라우트 분기·게이트 + 대기열 라우트 +
   서버 테스트. 이 시점부터 구멍이 닫히고, 팀장 UI가 아직 없어 큐는 비어 있다.
2. **PR 2 (관리자 UI)**: 대기열 패널 · 승인/반려 · 사이드바 배지 · 착지 점프.
3. **PR 3 (팀장 개방)**: `canPropose` · 승인 요청 토스트 · 대기 배지 · 내 요청 팝오버.

팀장 개방이 **마지막**이라 "요청은 올라가는데 처리할 화면이 없는" 구간이 없다.

## 부록 A. mc_code 채번 조사 (2026-07-30 실측 — 현행 유지 결정)

설계 중 확인한 질문: "2027년식 트림을 추가하고 부여하면 MC070527**001**? MC070527**014**?"

- **답: 014** — 채번은 연식과 무관한 **모델 통산 순번**이다. `assignMcCodes`의 `maxTrimCode`가
  "활성 트림 + 삭제 이력(trim_code_history) 통틀어 최대 + 1"이고, DB 제약
  `UNIQUE(model_id, trim_code)`가 이를 스키마 수준에서 강제한다. mc_code 조립은 DB 트리거
  `catalog.auto_generate_mc_code`: `MC + 브랜드(2) + 모델(2) + 연식%100(2) + trim_code(3)`.
- **순서 변경은 무영향** — sort_order는 미부여 트림이 여럿일 때 그들끼리의 채번 순서만 결정.
  기존 코드는 절대 안 바뀐다(트리거가 trim_code/mc_code 변경 차단).
- **연식별 리셋(MC070527001)으로 바꾸지 않기로 함**(유슨생, 의견 수렴): ①UNIQUE 제약 변경 +
  mutable한 model_year를 제약 축으로 쓰는 새 엣지 ②catalog는 앱 공유 — 앱 /admin/vehicles의
  동일 채번과 양쪽 동시 변경 필요 ③이미 5개 모델(Artura·Bentayga·Grecale·Nautilus·Urus)이
  두 연식에 걸쳐 통산 발급(총 1,669건·불변)이라 영구 혼합 상태가 남음 ④리셋하면 끝 3자리가
  같은 코드가 흔해져 혼동 위험 증가. 얻는 것은 미관뿐.

## 부록 B. 후속 후보 (이번 범위 밖)

- 딜러 제안 도착 배지를 사이드바 배지에 합산 (§7.5)
- 상담사(staff) 개방 여부 재론 — 필요해지면 `requireRoles`에 한 단어 + `canPropose` 확장으로 열린다
- 대기열 알림(FCM/디스코드) — 지금은 배지 폴링만

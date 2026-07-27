# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다(2026-07-21에 142k자까지 자랐다).
> 지속 결정·계약은 `AGENTS.md`, 설계 근거는 `ref/specs/*`, 장기 상태는 `ref/current-working-state.md`.

Last updated: 2026-07-27

## 지금 상태

**main 전량 green · 브랜치 0.** 07-27 머지 **8건**(`#372`~`#374` + 딜러 할인 `#375`~`#378` + main
직접 1건) · main `b4a2a90` · 마이그 **2건**(0039 `dealer_profiles` · 0040 `dealer_trim_discounts`).
검증: typecheck 0 · lint 0 · knip 0 · format 0 · unit **1193** · pure **247** · build · 실 DB 36건.

⚠️ **딜러 할인 파이프라인은 실기 확인이 통째로 남았다** — prod 배포는 됐지만 유슨생 눈 확인 0회.

## 직전 세션 요약 (07-27 오후 · 딜러 할인 제안 → 관리자 채택)

이사님 요구 = MC 마스터에서 **딜러가 자사·제휴·타사 할인만** 입력하고, 그 값은 catalog 확정가에
바로 들어가지 않는다. **관리자가 필드별로 채택**할 때 반영된다. 한 딜러=한 브랜드, 한 브랜드=여러 딜러.
spec = `ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md`(2단 구조 · §1~§10).

- **A(`#375`)** `crm.dealer_profiles` + admin `/api/dealer/profiles` + 조직 화면 브랜드·비고 매칭.
  PK가 `dealer_user_id` 하나라 "1딜러=1브랜드"를 스키마가 강제. brand_id FK 미도입(근거 스키마 주석).
- **B1(`#376`)** `crm.dealer_trim_discounts` + **`DEALER_WRITE_ALLOWLIST` 첫 개방**
  (`PUT /api/dealer/discounts/:trimId` 1줄) + 브랜드 소유권 fail-closed 403. cross-schema라 DB CHECK
  불가 = **서버가 유일 방어선** → **변이 검증 2회 실관찰**(소유권 제거 → 403 3건만 실패 / allowlist
  닫기 → 200 1건만 실패).
- **B2a(`#377`)** 사이드바 "할인 업데이트" 실동작화(딜러 메뉴 4개가 전부 onClick 없는 목업이었다) +
  Topbar 목업 `"BMW 한독/서초"` → 실데이터 `"BMW · 동성모터스"`(`roleAccountMeta` 상수 전멸) +
  자기 브랜드만(`scopeBrandId` — brands 도착 전 `?brand=` 통과 창 **및** modelId 독립 경로 둘 다 막음).
- **B2b(`#378`)** 할인 3셀 인라인 편집(위=내 제안·아래=확정값 회색) + **디바운스 800ms 자동 저장** +
  저장 실패 표시. 평면·그룹 두 테이블이 `TrimMetaCells`를 공유해 한 번에 반영.
- **main 직접(`62f85a9`)** 딜러에게 실시간 상담 패널 숨김(구: 회색 disabled로 남아 있었다) + 죽은 CSS 6룰.
- ⚠️ `profiles-write-guard`가 `dealerProfiles`를 오탐 → RULES 주석이 예견한 대로 **ALLOW 3건 명시
  등록**(정규식 불변) + **스테일 방지 테스트 신설**(등록 조각이 사라지면 실패).

## ▶ 그 다음 — 슬라이스 C (관리자 채택) · **계획 완비, 즉시 착수 가능**

**"CRM 이어가자"면 조사 없이 바로 시작한다:**
1. **`ref/plans/2026-07-27-crm-dealer-discount-c-adoption.md`** 를 읽는다 — Task 0~6 + 코드 + "확정된
   사실"(재조사 불필요 항목 8개: 트리거·쿼리 관례·게이트·profiles 조인·테스트 실행법·guard 오탐 등)
2. `superpowers:executing-plans`로 Task 0(브랜치)부터 순서대로
3. ⚠️ Task 1은 **마이그 0041이 공유 master에 들어간다** — Step 2의 생성 SQL 육안 검사를 건너뛰지 말 것

내용 = `crm.catalog_discount_adoptions`(필드 단위 감사) + 채택 트랜잭션 + 할인 셀 팝오버 +
상태 파생(채택됨/수정됨/미채택/자격상실). **지금은 이사님이 제안을 볼 화면이 0** — 딜러 입력값은
DB에만 쌓인다. ⚠️ 채택은 **앱 고객에게 보이는 확정 할인**을 바꾼다(실기 대상 트림을 신중히).

## 대기

**실기(유슨생)** = 딜러 계정 `디엘오토솔루션의 혁명적인 개`(BMW 매칭 완료)로 ①"할인 업데이트" 진입
②금액 입력 → 1초 뒤 "저장됨" → 리로드 유지 ③관리자 화면 확정값 불변 ④Safari 입력.
**판단(유슨생)** = 조직 화면은 [저장] 버튼 · 딜러 셀은 자동 저장 → 톤을 맞출지.
**제프** = B(iM `quotedVehiclePrice`·할인·보조금) · D(`catalogPrice`) · ⑦. ⚠️ B 전까지 iM+할인 조합 금지.
**이사님** = `ref/director-pending-confirmations.md` 14 · 16~30.

## Boot

1. `AGENTS.md` → 이 파일 순. 2. `git status --short --branch` · `git log --oneline -5`
3. 더 필요하면: 딜러 건 = `ref/specs/2026-07-27-crm-dealer-*` · `ref/plans/2026-07-27-crm-dealer-*`(3종) /
   과거 세션 = `ref/session-archive.md` / 제프 건 = `ref/2026-07-27-jeff-*`(3종)

## 세션 마무리 규칙

- 이 파일은 **교체**한다(누적 금지). 직전 세션 요약만 남기고 이전 것은 `ref/session-archive.md` 맨 위로.
- 행위 변경은 `ref/director-pending-confirmations.md`에 등재(PR 🟡와 병행). **단 유슨생이 그 자리에서
  승인하면 등재 없이 박제.** 이사님 확정 설계를 뒤집는 건은 승인 대신 등재.

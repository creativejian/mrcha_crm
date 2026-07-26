# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다(2026-07-21에 142k자까지 자랐다).
> 지속 결정·계약은 `AGENTS.md`, 설계 근거는 `ref/specs/*`, 장기 상태는 `ref/current-working-state.md`.

Last updated: 2026-07-26 (저녁)

## 지금 상태

**main 전량 green · 브랜치 0 · 미완 작업 없음.** 07-25 밤~07-26 머지 **9건**(`#363`~`#371`) · main `4c9c5a6` ·
마이그 0건. 눈 확인: `#365`~`#371` **전부 유슨생 확인 완료**. 검증: typecheck 0 · lint 0 · knip 0 · format 0 ·
unit **1174** · pure · build · edge 26 · server 697+(07-25 — "server green"은 언제든 스테일).

## 직전 세션 요약 (07-26 저녁 · 0726-mcMaster-scroll)

**mc-master 브랜드 URL·스크롤 3종 보존(`#371`) — 앱 admin 패리티.** 발단 = 유슨생 관찰("앱 차량 관리는
다른 페이지 갔다 와도 스크롤이 보존되는데 CRM은 안 된다"). 앱은 **3층**으로 담고 있었다 —
URL(`context.replace('/admin/vehicles?brand=N')`) + Riverpod provider + 위젯 **`static`** 스크롤
(`vehicle_list_screen.dart:20` · `vehicle_list/brand_panel.dart:30,98`). CRM은 셋 다 컴포넌트 로컬이라
라우트 언마운트(=메뉴 이동)에 전부 날아갔다(구 `modelScrollTop` ref 주석대로 **같은 화면 왕복만** 노린 구현).
- **브랜드 = URL `?brand=` SSOT**(`pages/mc-master/mc-master-route.ts`, 고객 목록 `?view=`와 같은 문법).
  폴백 = URL → `getBrandIdForModel` → **모듈 lastBrandId** → 첫 브랜드. Topbar 메뉴가 쿼리 없는
  `/mc-master`를 열기 때문에 모듈 폴백이 **필수**(URL만으로는 구멍) → 복원 후 `replace`로 URL 되맞춤.
  브랜드 전환도 replace(탭 전환 성격 — push면 뒤로가기가 브랜드 되짚기, 앱과 동일).
- **트림 뷰도 쿼리 유지**(`/mc-master/:modelId?brand=`) → 🟢 **기존 버그 동시 해소**: 역인덱스는 모델 캐시가
  채워져야 생겨서 트림 화면 **새로고침 시 비어 있었고**, 사이드바가 엉뚱한 브랜드를 하이라이트했다.
- **스크롤 3종 = 모듈 스코프**(`pages/mc-master/view-state.ts` = React판 `static`): 모델 목록 · **사이드바**
  (보존 자체가 없었다) · **트림 목록(모델별 Map)**. 트림을 모델별로 나눈 이유 = 단일 값이면 5 Series를
  보다 나간 뒤 3 Series가 엉뚱한 위치에서 시작한다(유슨생 세션 중 추가 요구).
- 캐시 불변 — URL에 brand가 있으면 첫 렌더에서 `getCachedModels` hit(왕복 0 유지), `models` 초기값도 캐시에서.
- ⚠️ **한계**: 모듈 스코프라 **새로고침하면 스크롤 초기화**(앱 static도 동일). 브랜드는 URL이 살린다.
  sessionStorage는 앱보다 과해서 뺐다(고지 완료·요청 시 추가).
- ⚠️ **검증 함정 2**: ①jsdom은 레이아웃이 없어 `scrollTop`이 늘 0 → **스크롤은 유닛 검증 불가**(실기가 유일,
  브랜드 URL 축만 유닛 4건으로 잠갔다) ②`agent-browser click`은 클릭 전 대상 행을 뷰포트로 스크롤해
  **저장값을 덮는다**(260→60 오탐 1회) — 스크롤 실기는 JS `element.click()`으로.

## ▶ 그 다음

1. **requireRole 확산(2/11)** — 이사님 항목 16 답 대기. 2. **항목 29 답** 오면 스누즈 트리거 조정(소형).
3. 실기 1개(비admin URL·비긴급) · **이월 L2**(createCustomerFromRequest 인라인 정리 — 그 파일 수정 때) ·
   pending-tasks 4건(디자인 확정 대기).

## 대기 (우리 액션 없음)

`ref/director-pending-confirmations.md` — 14 · 16~28 · **29(수동 관리 상태 만료 트리거)**.
**앱 쪽** = 애플 개발자 등록 후 재론(FCM 실기기·앱 #582) · 휴대폰 로그인 전환은 아직 구현 불가(요청문 보류 중).

## Boot

1. `AGENTS.md` → 이 파일 순. 2. `git status --short --branch` · `git log --oneline -5`
3. 더 필요하면: 과거 세션 = `ref/session-archive.md` / 경량 체크 = `ref/plans/2026-07-25-crm-lightweight-consistency-check.md`
   / 니즈 파생 = `ref/specs/2026-07-24-crm-featured-quote-request-needs-design.md`

## 세션 마무리 규칙

- 이 파일은 **교체**한다(누적 금지). 직전 세션 요약만 남기고 이전 것은 `ref/session-archive.md` 맨 위로.
- 행위 변경은 `ref/director-pending-confirmations.md`에 등재(PR 🟡와 병행). **단 유슨생이 그 자리에서 승인하면
  등재 없이 박제**(07-26: 칩 축·메모 A안·같은 번호 경고·mc-master URL 문법). 단 이사님 확정 설계를 뒤집는
  건은 승인 대신 등재(항목 29가 그 사례).

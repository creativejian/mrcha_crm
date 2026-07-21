# Mr. Cha CRM Active Session Brief

> **이 파일은 매 세션 자동 로드된다. 60줄 이하를 유지한다**(AGENTS.md 핸드오프 규칙).
> 과거 세션 로그는 여기 쌓지 말고 `ref/session-archive.md`로 보낸다 — 2026-07-21에 이 파일이
> 142k자까지 자라 세션 컨텍스트의 14%를 먹고 있었다. 지속되는 결정·계약은 `AGENTS.md`(불변 규칙),
> `ref/specs/*`(설계 근거), `ref/current-working-state.md`(장기 상태)가 각각 집이다.

Last updated: 2026-07-21 심야

## 지금 상태

전 작업 종결·머지·검증 완료. **진행 중인 미완 작업 없음.**

최근 머지(main): `#306` 미지원 기간·약정거리 워크벤치 게이트 · `#307` staff 담당자 재배정 차단.
main 통합 검증 green — typecheck 0 · lint 0 · unit 1038 · server 640 · build · knip 기준선 7/9.

## 직전 세션 요약 (2026-07-21 · 0721-work-sheets)

**① 파트너(제프) 대규모 리팩토링 감사 → CRM 깨진 곳 0.** cheapest(계약 재정의)는 CRM 미사용, calculate·dealers는 파트너가 "CRM 실사용 계약 — 제거 금지"로 보존. 미취급 처리도 이미 3경로 동작 중이었다(값 날조 없음).

**② 지원집합 게이트(#306).** 파트너 `GET /api/external/quotes/support-matrix` 신설 요청 → 계약 그대로 수락 → 구현 → 파트너 배포 → 실 API 스모크까지 하루에 종결.
- 계약 핵심: **`null`=미확정 / `[]`=전부 미지원(정반대)** · `(lenderCode, productType)` 키 조회 · **fail-soft**(파트너 DB 문제에도 200 + 항목만 null 강등 → 금융사×축 독립 판정).
- CRM: 릴레이 + 세션 캐시 + 순수 판정 → 워크벤치에서 **기간 disabled·약정거리 목록 제거**. 전 실패 경로 **fail-open**(게이트는 UX 개선, 방어선은 파트너 미취급 throw).
- **기간이 실제로 막히는 건 MG뿐**(12·24 미취급). 산은·iM·농협·장기렌트는 파트너 미확정이라 아직 안 막힌다 → Phase B 완료 시 **응답만 바뀌어 CRM 코드 변경 0으로 자동 확장**.
- spec `ref/specs/2026-07-21-crm-support-matrix-gate-design.md` · 파트너 요청/회신 `ref/2026-07-21-jeff-support-matrix-{request,reply}.md`

**③ staff 실기 감사 → 재배정 게이트(#307).** staff 실계정으로 고객 관리 전역 확인 — 기존 게이트(목록 스코프·타 담당 404·인박스 403·삭제 403·메뉴·검색·AI)는 **전수 정상**.
- **발견**: 담당자 재배정에 게이트 부재. staff가 본인 고객을 남에게 넘기면 **즉시 목록에서 사라져 스스로 되돌릴 수 없다**(실측 PATCH 200 → 목록 0건). 고객 하드 삭제(#212)와 같은 급 → admin·manager만(서버 403 + 화면 읽기 전용).
- **기각 박제**: `GET /api/staff` 차단 — 실시간 상담 콘솔의 채팅 세션 배정이 같은 API를 쓰고 그건 **다른 축**. 완전 차단은 채팅 배정 권한 결정이 선행(별건).
- spec `ref/specs/2026-07-21-crm-customer-role-scope-design.md` §6

## 다음 후보

- **배치 13 리팩토링 감사** — 미감사 = `#303`·`#304`·`#305`·`#306`·`#307`. 관례 규모 도달.
- **채팅 세션 배정 권한** — #307에서 기각한 `GET /api/staff` 차단의 선행 조건.
- **파트너 Phase B 완료 시** 산은·iM·농협 게이트 자동 점등 → 실기 1회(우리 몫 작업 없음).

## 대기 (우리 액션 없음)

`ref/director-pending-confirmations.md` — 항목 14(이사님 재판단) · 16·17(사후 공유).
실기 협조 2건(FCM 실기기·앱 #582 크로스)은 **애플 개발자 등록 후 재론** — 먼저 밀지 말 것.

## Boot

1. `AGENTS.md` → 이 파일 순으로 읽는다.
2. `git status --short --branch` · `git log --oneline --decorate --max-count=5`
3. 더 필요하면: 과거 세션 경위 = `ref/session-archive.md` / 장기 상태 = `ref/current-working-state.md` / 설계 근거 = `ref/specs/*`, `ref/plans/*`
4. 23개 원본 기획 문서는 전략·로드맵·아키텍처를 명시적으로 다룰 때만 읽는다.

## 세션 마무리 규칙

- 이 파일은 **교체**한다(누적 금지). 직전 세션 요약만 남기고 그 이전 것은 `ref/session-archive.md` 맨 위로 옮긴다.
- 행위 변경이 생기면 `ref/director-pending-confirmations.md`에 등재한다(PR 본문 🟡와 병행).
- 지속되는 계약·함정은 `AGENTS.md`에, 설계 근거는 `ref/specs/*`에 — 여기 쌓지 않는다.

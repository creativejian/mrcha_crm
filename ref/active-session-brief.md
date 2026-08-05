# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-08-05

## 지금 상태

main 전량 green(CI 8단계). unit **1378** · pure **281**. 회원탈퇴 CRM 몫·파기 감사 모두 종결.
출고/정산 축은 미결정 0이고 **정산 워크플로도 끊긴 곳 없이 이어졌다**(`#449` 단계 편집 UI) —
잔여 = 목록 컬럼 1건.

## ▶ 다음

- 🔴 **바로 착수 = 정산 목록 컬럼**. 비용/마진/상태를 목록에 보이려면 **목록 응답에 정산을 실어야
  하는데 "목록 미포함" 원칙과 정면 충돌**한다(`customers.settlement-exposure.test.ts`가 잠금) →
  **admin 전용 목록 조회 설계가 선행**이다(필드 마스킹은 레포에 선례 없음 — 라우트를 가르는 지금
  방식이 그 회피책이었다). 이 작업의 큰 diff에 **`CustomerManagementRow` 팝오버 분리를 흡수**시킨다
  (925줄 · 로컬 메모리 `crm-row-popover-split-trigger` — 분리 시 `usePopoverViewportClose`
  **selfRef 유지 필수**).
- **잔여 2건(머지는 끝났다 — 실행·육안만)**: ⓐ**김지운(`jiandolce@gmail.com`) 탈퇴 테스트 미실행**
  (견적 20·**앱카드 19** — 카드 회수 경로 검증) ⓑ`#445` 배너 **육안 미확인**(대기 큐 0건이라 안
  뜬다). **ⓐ를 하면 ⓑ가 딸려 온다**(탈퇴 접수 = 큐 1건 → 배너 노출).
- **🔴 시범 고객·풀세트 시드 재지정**(상세 드로어 작업의 선행 — 김민준 삭제로 공백). 어느 고객으로
  옮길지는 **이사님 결정 영역**이라 임의로 정하지 않는다(AGENTS.md).

## 직전 세션 (08-05 · 유슨생)

- **`#449` 정산 단계 편집 UI** — 담당자 "정산요청"을 admin이 **받는 화면이 없어** 워크플로가
  끊겨 있던 것을 이었다(서버는 진작 준비돼 있었고 클라만 `status`를 안 썼다). 정산 섹션
  **최상단**에 단계 select 3종(정산은 목록에 안 실려 이 팝오버가 요청을 보는 **유일한 접점**) ·
  "정산요청"만 주황 강조 · `bindSelect` 병행.
  ⚠️ **status는 조회 이후 바뀐 경우에만 body에 싣는다** — 항상 보내면 admin이 팝오버를 열어 둔
  사이 담당자가 올린 요청을 저장 한 번으로 조용히 "미정산"으로 되돌린다(양쪽 다 모른다). patch가
  부분인 이유가 이것이다. 회귀 그물 = 클라 "status를 아예 보내지 않는다" + 서버 "admin 단계 전이"
  **2종 모두 변이 주입으로 무는 것까지 확인**.
  CSS: `.delivery-info-popover select`에 input과 같은 결 → **비용 종류 select도 함께** 정돈(육안 확인).
- **🔴 김민준(`CU-2605-0020`) 삭제됨** — 탈퇴 실경로 테스트(전량 파기·복구 불가). **유일한 풀세트
  시드**였다 → 위 "시범 고객 재지정"이 선행(AGENTS.md 반영).
- 08-04 오후 세션(파기 감사 `#442` · 의존성 `#443`·`#444` · 정산 계약 `#446`·`#447` · 팝오버
  `#448` · 이월 실기 4건 종결)은 `ref/session-archive.md` 맨 위로 옮겼다.

## 대기

**이사님** = `ref/director-pending-confirmations.md` **16건**(항목 14·16~30) + Supabase
**"EXCEEDING USAGE LIMITS" 배지**(08-01) 플랜 + **D+5 최악 6일차** SLA 해석.
💡 회신 때 **🟡 하드 삭제 확장(`#440`)을 항목 28**(AI 기록에 번호 잔존)**과 묶을 것** — 같은 축·미등재.

## Boot

`AGENTS.md` → 이 파일 → `git status -sb` · `git log --oneline -5`. 상세: 정산 = spec §6a · 보존 계약 = AGENTS.md.

## 세션 마무리 규칙

**교체**(누적 금지 · 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인은 등재 없이 박제** · 이사님 확정
설계를 뒤집는 건만 등재 · 신설 시 그 파일 롤업 2곳도). 상세 규칙 = AGENTS.md "Handoff Documents".

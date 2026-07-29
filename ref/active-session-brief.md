# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-07-29

## 지금 상태

**main 전량 green · 브랜치 0.** 딜러 도메인(07-27~29, `#372`~`#387`) **코드·문서·테스트·실 DB
4면 정합 확인 완료** — 잔여 코드 작업 0. 4종 0 · unit **1207** · 실 DB 딜러 5파일 55 ·
`check:residue` 0. ⚠️ **prod 눈 확인 0회**(`#379`~`#387` 누적) — 남은 건 이것뿐.

## 직전 세션 요약 (07-29 · 유슨생 — 딜러 도메인 경량 체크 `#387`)

- **배치 15 이후 새 관례(트리거 기반·경량)의 첫 실전 적용.** 트리거 = ⓐ실 데이터 변형(채택→
  `catalog.trims` 실반영·삭제 2종·마이그 3건). 무검증 머지 0이라 기본형(2앵글+실측 렌즈 1)로 수행,
  적대 검증은 상/중 대상인데 해당 없음. **판정 SSOT =
  `ref/plans/2026-07-29-crm-dealer-domain-lightweight-check.md`**(의도적 미수정 근거 포함).
- **결과 상 0 · 중 0 · 하 5, 전건 수정**: ①`dealer.ts` 헤더 미래형 스테일("B는 나중에" — 기구현)
  ②spec §6.3 라우트 표 3중 스테일(트림→모델 미반영·`/api/dealer-profiles` 오기·roster/삭제 부재)
  ③EOF 이중 개행 + `DealerBrandCell` 죽은 `entry?` 가드 8곳(타입 조임) ④roster **응답 계약 잠금
  신설**(클라 `DealerRosterEntry` 동형 — 매핑 누락이 화면을 조용히 비우는 유형) ⑤`proposalCount`
  (삭제 confirm "지울 N건" 근거) 커버 추가.
- **실측 이상 없음**: 실 DB 고아 0(매칭·제안·감사 4축) · 감사 사슬 정합 — (trim,field)별 최신 감사
  = 현재 확정값(708 = BMW 523d: 자사 5,300,000 관리자 직접 · 제휴 6,000,000 딜러 채택) ·
  행수 매칭 1·제안 1·감사 3 · `#382` 채택 차단 18케이스 기커버 · CSS 죽은 룰 0.
- **의도적 미수정 1건**: PUT 대상 가드 positive **라우트** 경로(admin→실 딜러 200) — 라우트
  테스트는 커밋되므로 실 딜러 행을 변형한다(#381 "실 트림 수정=스탬프 오염"과 같은 축). 판정
  함수(`isDealerRole`)·부정 경로(409+행 미생성)·쿼리 upsert가 각각 잠겨 배선 1칸만 실기 영역.
- 관례 소감(박제): 반나절 풀 감사 없이 스테일 문서 2건·계약 잠금 2건 — **경량 관례가 의도대로 작동**.

## ▶ 다음 — 미확정

**"CRM 이어가자"면 먼저 택1을 물을 것**: ①prod 눈 확인(`#379`~`#387` 일괄 — 조직 딜러 표·confirm
저장·딜러 모드까지 한 바퀴) ②채택 되돌리기(undo — `previous_amount` 있음) ③제안 도착 알림 배지("대기 N건")

## 대기

**prod(유슨생)** = `#379`~`#387` 눈 확인 1회(로컬만 검증). **판단(유슨생)** = `dev:api --watch`
도입(실 DB 커넥션 재수립 트레이드오프). **이사님** = ⓐBMW 523d(`MC070526001`) 자사 5,300,000·제휴
6,000,000 실데이터 유지 판단 ⓑspec §7.1 뒤집힘 ⓒ`ref/director-pending-confirmations.md` **16건**.
**제프** = **전면 종결 재확인**(07-29 오후 서면 `debfcb8`): sync 실행 완료·~~4월 사본~~ 오독 정정
→ **F 재평가 무효·대기 소멸**(CRM 할 일 없음 명문). API 재실측 회귀 0(iM 846,710·산은
catalogPrice 미탑재 유지). colors 56건 FK 스킵(#116 §5)도 **채팅으로 합의 종결** — 그쪽 버그
접수·통지 프로토콜 불필요(전량 fetch라 유실 0, 근거·원문 =
`ref/2026-07-29-jeff-sync-dryrun-colors-followup.md` 후기). 그쪽 잔여 = 매핑 픽스+sync 1회+56건
유입 확인. 기억 2건: ⓐcheapest 쓰게 되면 **사전 통지**(검출축 없는 경로) ⓑC 거부 게이트 켜지면
경고→차단 전환.

## Boot

`AGENTS.md` → 이 파일 → `git status --short --branch` · `git log --oneline -5`. 더 필요하면
딜러 건 = `ref/{specs,plans}/2026-07-27-crm-dealer-*`·`ref/plans/2026-07-29-*-lightweight-check.md`
/ 과거 = `ref/session-archive.md`.

## 세션 마무리 규칙

이 파일은 **교체**(누적 금지, 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인 시 등재 없이 박제** · 이사님 확정 설계를
뒤집는 건은 등재 · **신설 시 그 파일 롤업 2곳도 함께 갱신**).

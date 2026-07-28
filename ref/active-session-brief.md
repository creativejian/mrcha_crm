# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-07-28 (저녁)

## 지금 상태

**main 전량 green · 브랜치 0.** 오늘 머지 5건(`#382`~`#386`) + main 직접 1(`4acd193`). 4종 0 ·
unit **1207** · pure 259 · `check:residue` 0 · 실 DB는 딜러 관련 3파일만 재실행(35 pass — 전체
스위트 755는 07-28 새벽이 최신). **딜러 도메인 = 입력→채택→명부·정리 완결.** ⚠️ **prod 눈 확인
0회**(`#379`~`#386` 누적).

## 직전 세션 요약 (07-28 낮~저녁 · 유슨생 — 조직 「딜러」 명부 3부작 + 서명)

- 오전 세션(`#382` 채택 자격에 브랜드 일치 추가 · `#383` 딜러 화면 "제안변경일")이 타이핑 불능으로
  중단 → 이 세션이 워킹트리를 인계받아 검증 후 `#384`로 완성.
- **`#384` 딜러 명부 분리** — 구성원 표에서 딜러를 별도 테이블로(컬럼이 상이해 서로 빈 칸만 만듦).
  목록 = **합집합**(`role='dealer'` OR `dealer_profiles` 존재) — role 내려간 딜러가 사라지면 정리할
  행 자체가 없다. 삭제 2종(입력값 삭제=제안만 / 딜러 해제=제안+매칭 한 트랜잭션). 🔒 **어느 버튼도
  채택된 확정 할인·채택 감사는 안 지운다** — 실 DB 테스트가 "지우지 않는 것"을 잠금. 버튼 = `.badge` 칩 재사용.
- **`#385` "현재 딜러 아님" 행** — 편집 차단은 disabled가 아니라 **폼 컨트롤 제거(텍스트 렌더)**
  (disabled select는 화살표가 남아 안 읽힘 — 실기 피드백 2회). + **서버 대상 가드**: PUT
  `/profiles/:userId` 대상이 딜러 아니면 409(`isDealerRole` — 채택 가드와 같은 read-through.
  TDD RED로 유령 uuid PUT→200+실 행 생성을 실확인). 텍스트 정렬 = `.org-dealer-plain` 8px.
- **`#386` 저장 UX** — 저장 버튼 제거: 브랜드=선택 즉시 confirm(변경 시 "제안 N건 채택 불가" 경고) ·
  비고=blur/Enter 자동 저장 · 미지정이면 비고 잠금("브랜드 먼저 지정" — 사전 차단 > 경고 팝업).
  ⚠️ **confirm은 비멱등 → Safari select 병행 바인딩 금지** — onInput은 ref 보관만, 실행은 onChange
  1곳 + **ref 먼저** 읽기(Safari가 복원한 구값이 truthy). 구 보류 판단 "저장 톤 통일"은 이걸로 해소.
- **main 직접(`4acd193`)** 계정 메뉴 서명 `"CRM by Creativejian"` + 딜러 모드 이중선 제거.
- **결정**: 브랜드 단위 제안 삭제는 안 만든다(브랜드 갈아탔다 복귀 시 타 브랜드 제안 잔존 노이즈 —
  드묾·채택은 서버가 차단·전환 시점에 "입력값 삭제"로 처리 가능). spec §7.3 개정 완료(이 커밋).
- ⚠️ `dev:api` watch 없음 재확인 — 오늘도 dev 이중 기동·8788 포트 충돌로 반쪽 기동을 밟았다.
  백엔드 수정 후 **기존 프로세스 확실히 내리고** `PUSH_NOTIFY=off bun dev` 재시작.

## ▶ 다음 — 미확정

**"CRM 이어가자"면 먼저 택1을 물을 것**: ①prod 눈 확인(`#379`~`#386` 일괄) ②채택 되돌리기(undo —
`previous_amount` 있음) ③제안 도착 알림 배지("대기 N건")

## 대기

**prod(유슨생)** = `#379`~`#386` 눈 확인 1회(로컬만 검증). **판단(유슨생)** = `dev:api --watch`
도입(실 DB 커넥션 재수립 트레이드오프). **이사님** = ⓐBMW 523d(`MC070526001`) 자사 5,300,000·제휴
6,000,000 실데이터 유지 판단 ⓑspec §7.1 뒤집힘 ⓒ`ref/director-pending-confirmations.md` **16건**.
**제프** = B(iM `quotedVehiclePrice`·할인·보조금) · D(`catalogPrice`) · ⑦. ⚠️ B 전까지 iM+할인 조합 금지.

## Boot

`AGENTS.md` → 이 파일 → `git status --short --branch` · `git log --oneline -5`. 더 필요하면
딜러 건 = `ref/{specs,plans}/2026-07-27-crm-dealer-*` / 과거 = `ref/session-archive.md`.

## 세션 마무리 규칙

이 파일은 **교체**(누적 금지, 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인 시 등재 없이 박제** · 이사님 확정 설계를
뒤집는 건은 등재 · **신설 시 그 파일 롤업 2곳도 함께 갱신**).

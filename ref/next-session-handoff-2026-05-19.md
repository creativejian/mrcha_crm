# 다음 세션 인계문서 - 2026-05-19 고객관리 리스트 컬럼/UI

이 문서는 새 세션에서 이사님이 `영실아 이어가자`라고 했을 때 이번 세션 작업 맥락을 바로 복원하기 위한 인계문서다.

## 새 세션 시작 시 먼저 읽을 파일

1. `/Users/jian/.codex/memories/START_HERE_MRCHA.md`
2. `/Users/jian/.codex/memories/MRCHA_CONTINUITY_PROTOCOL.md`
3. `/Users/jian/.codex/memories/mrcha-project-context.md`
4. `/Users/jian/Documents/creativejian/mrcha/docs/codex-continuity-brief.md`
5. `/Users/jian/Documents/creativejian/mrcha/docs/mrcha-context-digest.md`
6. `/Users/jian/Documents/creativejian/mrcha/crm/ref/tech-stack.md`
7. `/Users/jian/Documents/creativejian/mrcha/crm/ref/current-working-state.md`
8. `/Users/jian/Documents/creativejian/mrcha/crm/ref/pending-tasks.md`
9. 이 파일: `/Users/jian/Documents/creativejian/mrcha/crm/ref/next-session-handoff-2026-05-19.md`

그 다음 CRM repo 상태를 확인한다.

```bash
cd /Users/jian/Documents/creativejian/mrcha/crm
git status --short --branch
git log --oneline --decorate --max-count=5
```

## 이번 세션 최종 상태 요약

- 고객 관리 > 전체 보기 리스트의 주요 실무 컬럼을 대폭 다듬었다.
- 현재 전체 보기 컬럼 순서:
  - `선택 / 고객 / 차종·구매방식 / 진행 상태 / 계약 가능성 / 상담 메모·문의 사항 / 유입·상담 / 담당 / 관리`
- 고객, 차종·구매방식, 진행 상태, 계약 가능성, 상담 메모·문의 사항, 관리 AI 힌트까지 1차 시각 설계가 들어가 있다.
- 아직 전체 UI 최종 확정은 아니다. 지금은 리스트 핵심 컬럼을 실무 화면 기준으로 맞추는 과정이다.
- 이번 세션 마지막 요청은 진행 상태 1차 버튼의 텍스트 크기/농도를 계약 가능성 버튼 기준으로 1차/2차 모두 맞추는 것이었고, 반영 및 Playwright 측정까지 완료했다.

## 현재 변경 파일

커밋 `ed4f04c feat: refine customer management list` 이후 아직 커밋되지 않은 파일:

```text
M client/src/data/customers.ts
M client/src/index.css
M client/src/pages/CustomerManagementPage.test.tsx
M client/src/pages/CustomerManagementPage.tsx
M ref/current-working-state.md
M ref/pending-tasks.md
A ref/next-session-handoff-2026-05-19.md
```

이 파일 목록은 새 세션에서 다시 `git status --short --branch`로 확인한다.

## 오늘 주요 결정/반영

### 고객번호

- 고객번호는 `CU-2605-0020`부터 `CU-2605-0001`까지 반영했다.
- 1페이지 맨 위 김민준이 `CU-2605-0020`, 2페이지 가장 아래 한소희가 `CU-2605-0001` 구조다.
- 기준은 `CU-YYMM-####` 월 단위 접수 순번 목업이다.

### 차종·구매방식

- 컬럼명은 `차종 · 구매방식`으로 사용 중이다.
- 구조는 `모델 / 트림 / 구매방식` 3단이다.
- 차선생 차량 데이터 구조는 `브랜드 > 모델 > 트림`이지만, 리스트에서는 브랜드 대신 트림을 보여주는 방향을 테스트 중이다.
- 긴 트림명은 `trimShort`로 축약 표시하고 원문은 `title`에 보존한다.
- 복수 모델/구매방식은 대표값 옆 `+1`, `+2` pill로 표시한다.
- `+N` pill은 클릭/hover 시 말풍선 형태로 추가 고민을 보여주는 계열이다.
- tooltip 문구는 문장형을 사용한다.
  - 예: `GLC도 고민 · 비교 중..`
  - 예: `할부도 고민 · 비교 중..`
- `+N` pill, 상담 메모 pencil, 관리 컬럼 3개 버튼은 작은 조작 버튼 계열로 radius `5px`, border/shadow/hover 톤을 맞췄다.

### 진행 상태

- 기존 3줄 구조 `상태 뱃지 / 상태그룹·시간 / 후속 신호`는 리스트에서 실무 부담이 커 보인다는 판단으로 보류했다.
- 현재 전체 보기에는 `[1차 상태] › [2차 상태]` 2단계 버튼 preview를 적용했다.
- 1차 상태:
  - `신규`
  - `상담중`
  - `견적`
  - `차량체크`
  - `심사서류`
  - `관리중`
  - `상담완료`
  - `계약완료`
  - `불발`
- 2차 상태는 1차 상태에 종속된다.
  - `신규`: `상담접수`, `1차부재중`, `지속적부재`, `연락해야함`
  - `상담중`: `구매방식상담중`, `차량상담중`, `견적상담중`
  - `견적`: `준비중`, `발송완료`, `추후안내예정`
  - `차량체크`: `재고확인중`, `재고있음`, `재고없음`, `대기필요`
  - `심사서류`: `서류상담중`, `서류안내함`, `서류대기중`, `서류받음`
  - `관리중`: `부결후관리`, `구매시기미도래`, `추후재컨택`, `조건재확인`
  - `상담완료`: `재상담대기`, `구매시기미도래`, `추후재컨택`
  - `계약완료`: `딜러사계약중`, `대리점발주중`, `특판발주중`, `배정완료`, `출고완료`
  - `불발`: `계약취소`, `지속적부재`, `추후재컨택`, `구매철회`
- 기능 흐름:
  - 1차 버튼 클릭 -> 1차 상태 popover
  - 1차 상태 선택 -> 해당 상태의 첫 2차 상태가 반영됨
  - 곧바로 2차 상태 popover가 자동으로 열림
- 2차 popover가 열린 동안 1차 버튼과 연결 화살표도 active 톤을 유지한다.
- 1차/2차 popover는 같은 고정 폭과 같은 왼쪽 기준을 사용하고, 꼬리표만 각 버튼 중심에 맞추는 방향으로 정리했다.
- 현재 상태값은 UI/UX 목업용이다. 실제 상태값 체계는 고객 상세 페이지에서 확정해야 한다.

### 진행 상태 버튼 스타일

- 2026-05-19 세션 마지막에 이사님 요청으로 1차 버튼 텍스트가 작고 연해 보이지 않게 수정했다.
- 현재 1차/2차/계약 가능성 버튼 기준:
  - height `24px`
  - font-size `11px`
  - font-weight `800`
  - padding left/right `10px`
  - radius `7px`
  - shadow 계열 동일
  - 기본 1차 버튼 배경 `#f3f6f9`, 텍스트 `#344051`
- 2차 버튼과 계약 가능성 버튼은 같은 골격을 쓰고 색상만 상태값에 따라 달라진다.
- 1차 버튼 패딩을 키우면서 좁은 화면에서 긴 2차 상태값이 계약 가능성 버튼과 맞닿을 수 있어, 컬럼 폭도 함께 조정했다.

### 계약 가능성

- 헤더는 `계약 가능성`을 유지한다.
- `전환 가능성`도 논의했지만, 상담사 관점에서는 `계약 가능성`이 더 직관적이라는 판단으로 유지했다.
- 컬럼 위치는 `진행 상태` 바로 뒤다.
- 이유: 진행 상태와 계약 가능성을 하나의 판단 묶음으로 스캔하는 편이 실무상 빠르다.
- 헤더/본문 모두 왼쪽 정렬이다.
- 현재 계약 가능성 헤더/본문에는 임시로 `translateX(-10px)`가 들어가 있다.
  - 이사님이 진행 상태와 더 가깝게 보이길 원해 임시 테스트로 적용했다.
  - 다음 세션에서 실제 화면을 보고 유지/완화/컬럼 폭 재조정 판단 필요.

### 상담 메모·문의 사항

- 기존 `다음 할 일`은 너무 범위가 좁아 `상담 메모`로 바꿨고, 이후 헤더는 `상담 메모 · 문의 사항`으로 확장했다.
- 이 컬럼은 AI가 자동 생성하는 요약보다 담당자가 직접 남기는 실무 메모가 주도권을 갖는 구조다.
- 본문 텍스트는 고객명/차종명처럼 튀지 않게 낮췄다.
  - `#4f5a64`
  - `12px`
  - `font-weight: 500`
  - `line-height: 1.56`
  - 최대 3줄 clamp
  - 수동 줄바꿈 저장 시 `white-space: pre-line`로 그대로 반영
- pencil 버튼을 누르면 인라인 수정 textarea가 열린다.
- 편집 UX:
  - Enter 저장
  - Esc 취소
  - 체크 버튼 저장
  - X 버튼 취소
  - Eraser 버튼은 메모 비우기
  - 입력창 바깥 클릭 시 현재 draft 저장 후 편집 종료
  - 편집 진입 시 커서는 문장 끝으로 이동
- 편집 버튼 스택은 textarea top/center/bottom과 미세 정렬을 맞췄다.
- 현재 상담 메모는 프론트 상태에서만 변경된다. API 저장은 아직 없다.

### AI 요약

- 기존 상시 컬럼 `AI 요약`은 제거했다.
- AI 요약은 `관리` 컬럼의 가장 왼쪽 AI 힌트 버튼으로 이동했다.
- 이유: 리스트 본문에서는 담당자 메모가 주도권을 갖고, AI는 필요할 때만 참고하는 보조 정보가 더 적합하다.
- AI 힌트 버튼은 `/Users/jian/Downloads/ix--ai.svg` 기반 아이콘을 사용했다.
- 기본 상태는 오른쪽 관리 버튼들과 같은 회색 톤, hover/active 시 보라색으로 전환된다.
- hover tooltip은 차선생 메인 컬러 `#5836ff` 배경과 흰색 텍스트를 사용한다.
- AI 힌트 tooltip 문장은 문장 안에서 핵심어만 굵게 표시하는 구조다.
- 제목/설명 2단 구조는 AI가 무거워 보이고 품질이 낮아 보인다는 판단으로 쓰지 않는다.

### 관리 버튼 / 작은 조작 버튼 계열

- `+N` pill, 상담 메모 pencil, 관리 컬럼 AI/상담/문서 버튼은 작은 조작 버튼 계열로 통일했다.
- 기본 상태:
  - 약한 border
  - 흰색/연회색 배경
  - 낮은 shadow
  - radius `5px`
- hover:
  - 차선생 메인 컬러 계열 border/배경
  - 살짝 위로 뜨는 transform
- hover 이동량은 체감 기준으로 조정했다.
  - `+N`/pencil은 `-1px`
  - 관리 버튼은 `-1.75px`

### 컬럼 폭/리듬

- 현재 전체 보기 기준 주요 폭:
  - 고객 `122`
  - 차종·구매방식 `130`
  - 진행 상태 `154`
  - 계약 가능성 `68`
  - 상담 메모·문의 사항 `266`
  - 유입·상담 `70`
  - 담당 `70`
  - 관리 `80`
- 진행 상태 1차 버튼 크기를 키운 뒤, 긴 2차 상태값이 계약 가능성과 맞닿지 않도록 진행 상태를 넓히고 상담 메모를 줄였다.
- Playwright 1440px 기준 긴 상태값도 진행 상태와 계약 가능성 사이 최소 `5.23px` 여백을 확보했다.
- 단, 전체 컬럼 리듬은 아직 최종 확정이 아니다. 다음 세션에서 실제 화면을 보고 계속 다듬을 가능성이 높다.

## 검증 기록

이번 세션에서 실행/확인한 것:

```bash
bun run typecheck
bun run test:unit client/src/pages/CustomerManagementPage.test.tsx
bun run lint
bun run build
```

결과:

- `typecheck` 통과
- `CustomerManagementPage.test.tsx` 10개 통과
- `lint` 통과
  - 단, 기존/잔여 warning 6개 있음:
    - `Topbar.tsx` hook dependency 2개
    - `ui/badge.tsx`, `ui/button.tsx` fast refresh 2개
    - `CustomerManagementPage.tsx` hook dependency 2개
- `build` 통과

Playwright로 확인한 주요 캡처/측정:

- `screenshots/customer-stage-button-consistency-1920.png`
- `screenshots/customer-stage-button-consistency-1440-after-width.png`
- `screenshots/customer-stage-all-two-step-1440.png`
- `screenshots/customer-stage-primary-popover-1440.png`
- `screenshots/customer-stage-secondary-popover-connected-1440.png`
- `screenshots/customer-chance-shift-10-memo-align-1440.png`

마지막 Playwright 측정:

- 1차 버튼, 2차 버튼, 계약 가능성 버튼 모두:
  - height `24`
  - font-size `11px`
  - font-weight `800`
  - padding left/right `10px`
  - border-radius `7px`
  - shadow 동일 계열
- 1440px에서 긴 상태값과 계약 가능성 버튼 사이 최소 간격 `5.23px`.

## 서버 상태 주의

- 이번 세션 중 Vite dev server가 여러 포트로 떠 있는 것이 확인됐다.
- 이사님이 “혹시 모르니까 서버는 건들지 말라”고 했으므로 종료하지 않았다.
- 새 세션에서 서버를 새로 띄우기 전에 먼저 현재 접근 가능한 포트를 확인하는 것이 좋다.
- 포트가 밀리는 이유는 기존 `bun run dev:client` / Vite 프로세스가 남아 있기 때문이다.
- 새 세션에서 이사님이 명확히 요청하기 전에는 서버 종료 작업을 하지 않는다.

## 다음 세션에서 바로 이어갈 일

1. `영실아 이어가자`를 받으면 위 부팅 문서들과 이 문서를 먼저 읽는다.
2. `git status --short --branch`로 변경 파일을 확인한다.
3. 서버는 건드리지 말고, 먼저 현재 접속 가능한 로컬 포트를 확인한다.
4. 고객 관리 전체 보기 화면에서 다음을 실제 화면으로 확인한다.
   - 진행 상태 1차/2차 버튼이 계약 가능성 버튼과 같은 크기/농도로 보이는지
   - 계약 가능성 컬럼이 너무 왼쪽/오른쪽으로 치우치지 않았는지
   - 상담 메모·문의 사항과 유입·상담 사이 간격이 답답하지 않은지
   - 1440px 또는 이사님이 자주 쓰는 살짝 줄인 창에서 컬럼 리듬이 안정적인지
5. 그 다음 이사님과 다음 컬럼/기능을 이어간다.

## 보류/주의할 판단

- 진행 상태의 실제 상태값 체계는 아직 확정이 아니다. 현재 값은 UI 목업용이다.
- 1차/2차 진행 상태 popover의 세부 디자인은 고객 상세 페이지에서 진행 상태 히스토리/권한/자동화 조건을 정한 뒤 다시 설계해야 한다.
- 계약 가능성의 `translateX(-10px)`는 임시 시각 보정이다. 다음 세션에서 실제 화면 판단 후 유지 여부를 결정한다.
- 상담 메모 인라인 수정은 현재 프론트 상태 저장만 한다. DB/API 연결은 추후 작업이다.
- 관리 컬럼의 AI 힌트는 hover 기반 보조 정보다. 실제 AI 생성/요약 API는 아직 연결하지 않았다.
- 이번 세션 마지막에 서버 종료를 시도하려다 이사님이 중단했고, 이후 서버는 건드리지 않기로 했다.

## 작업 원칙 재확인

- 이사님이 의견형으로 말하면 바로 구현하지 말고, 영실의 전문 판단을 먼저 말한 뒤 `적용할까요?`로 확인한다.
- 이사님이 `가자`, `해줘`, `수정해`, `적용해`, `진행하자`라고 하면 실행한다.
- UI 작업은 Playwright screenshot/측정을 적극적으로 사용한다.
- 눈대중으로 “같다”고 하지 말고, 필요하면 실제 bbox/style 값을 확인한다.
- 차선생 CRM은 조용하고 고급스러운 운영툴이다. 보라색은 필요한 상태/초점에만 제한적으로 사용한다.
- 새 버튼/배지를 만들면 같은 의미의 기존 버튼/배지와 radius, border, shadow, hover, baseline, text weight를 먼저 비교한다.

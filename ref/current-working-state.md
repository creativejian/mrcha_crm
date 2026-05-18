# 차선생 CRM Current Working State

Last updated: 2026-05-18

이 문서는 새 세션에서 `영실아 이어가자`라고 했을 때, 현재 CRM 작업 지점을 빠르게 복원하기 위한 최신 작업 상태 문서다.

## 현재 작업 초점

- 고객 관리 > 전체 보기 리스트의 실무형 컬럼/테이블 UI를 다듬는 중이다.
- 기존 디엘오토솔루션 CRM 화면을 참고하되, 차선생 CRM은 더 조용하고 고급스러운 운영툴 UI로 재해석한다.
- 현재는 컬럼 요소를 하나씩 논의하고, 반영하고, 화면에서 채택/수정/보류를 판단하는 방식으로 진행한다.
- 컬럼 요소가 확정되면 고객 관리 페이지 전체 레이아웃과 디자인을 다시 정리할 예정이다.

## 최근 확정/반영된 고객 리스트 UI

- 체크박스 컬럼
  - 컬럼 폭을 줄여 테이블 가로 공간을 효율화했다.
  - 체크박스는 기본 15px로 확정했다.
  - 테두리 대신 얇은 border + 약한 shadow로 떠 있는 느낌을 준다.
  - checked 상태는 차선생 메인 컬러 `#5836ff`를 사용한다.
  - header checkbox와 row checkbox의 정렬/중심을 맞췄다.
  - 관리 버튼도 체크박스와 비슷한 border/shadow 톤으로 맞췄다.

- 고객 컬럼
  - 현재 구조: 이름 + 고객번호 / 고객유형·상세 / 연락처
  - 이름이 가장 강한 위계다.
  - 고객번호는 이름 오른쪽에 붙되, 이름보다 연하고 작게 표시한다.
  - 고객번호는 `CU-2605-0020`부터 `CU-2605-0001`까지 2026년 5월 접수 순번 목업으로 반영했다.
  - 직군/상세와 연락처는 비슷한 속성으로 묶되, 연락처는 실무상 빠르게 읽히도록 약간 더 선명하게 둔다.
  - 이름과 고객번호 사이 간격은 시각적으로 충분히 띄워 위계를 명확히 했다.
  - 목업 정렬 테스트용으로 긴 한글 이름 `홍빛나리`, 영문 이름 `Daniel Kang`을 넣어둔 상태다.

- 전체 보기 컬럼 순서
  - 고객 다음에는 `차종 · 구매방식` 컬럼을 바로 배치한다.
  - 이유: 실무 스캔에서 `누구인지` 다음으로 `어떤 차를 어떤 구매 방식으로 보는지`가 상담/견적 판단에 가장 직접적이다.
  - 최고관리자/팀장 기준 전체 보기 순서: `선택 / 고객 / 차종·구매방식 / 진행 상태 / 다음 액션 / AI 요약 / 유입·상담 / 담당 / 가능성 / 관리`.
  - 상담사/딜러 기준에서는 `담당` 컬럼을 숨긴다. 상담사 관점에서 담당자는 본인이므로 실무 우선순위가 낮고, 딜러 화면은 별도 설계 전까지 담당 컬럼을 노출하지 않는다.
  - 차종/구매방식 컬럼은 `모델 / 트림 / 구매방식` 3단 위계로 표시한다.
  - 긴 트림 원문은 리스트에서 축약형 `trimShort`로 보여주고, 원문은 `title`로 보존한다. 예: `26년형 가솔린 터보 2.5 하이브리드 (9인승)` -> `2.5T 하이브리드 · 9인승`.
  - 복수 차종/구매방식은 리스트에서 대표값 + `+N` pill로 표시하고, hover tooltip에 추가 목록을 보여준다. 예: `Maybach S-Class +1`, `운용리스 +1`.
  - `+N` pill 자체는 그레이/화이트 톤을 유지하고, hover tooltip만 차선생 메인 컬러 `#5836ff` 배경과 흰색 텍스트를 사용한다.

- 진행 상태 컬럼
  - 기존 `단계` 헤더는 모호해서 `진행 상태`로 변경했다.
  - 리스트에서는 상세 단계 설계 전까지 `상태 뱃지 / 상태그룹·시간 / 후속 신호` 3줄 구조로 표시한다.
  - 후속 신호 예: `응답 대기`, `견적 작성`, `서류 대기`, `출고 준비`, `정산 확인`, `2차 예정`.
  - 2026-05-18 기준 상태 뱃지는 클릭 가능한 `진행 상태` 버튼으로 바꿨다.
  - 상태 버튼의 드롭다운 chevron은 반복 테이블에서 시각 노이즈가 커서 제거했다.
  - 상태 버튼은 체크박스/관리 버튼/`+N` pill과 같은 계열의 약한 border, inset highlight, shadow로 살짝 떠 있는 느낌을 준다.
  - 상태 버튼을 누르면 진행 상태 popover가 열리고, `customerStatusGroups` 기준 상태를 직접 선택할 수 있다.
  - 진행 상태 popover는 상단바 AI/알림 popover와 같은 계열의 `12px radius`, `var(--line)` border, 깊은 shadow, 상단 꼬리, 짧은 진입 animation을 사용한다.
  - 진행 상태/가능성 popover가 열린 상태에서 외부 영역을 클릭하면 첫 클릭은 popover 닫기만 수행한다. 행/버튼/링크 같은 하위 액션은 같은 클릭에서 실행하지 않는다.
  - popover 진입 animation은 뒤쪽 테이블 텍스트가 비쳐 보이지 않도록 opacity 전환 없이 transform만 사용한다.
  - 선택 시 목업 프론트 상태에서 `status/statusGroup`과 후속 신호가 함께 갱신된다. 아직 API 저장/히스토리 기록은 연결하지 않았다.
  - 단, 진행 상태 popover 내부 구성/세부 디자인은 pending task로 보류했다. 고객 상세 페이지에서 실제 진행 상태 값과 분류가 확정된 뒤 다시 설계한다.
  - 상세 단계/히스토리/자동화 조건은 고객 상세 페이지에서 별도로 다룬다.

- 가능성 컬럼
  - 헤더명은 `가능성`이 아니라 `계약 가능성`으로 확정했다. 의미가 계약 전환 가능성임을 명확히 하기 위해서다.
  - 기존 단순 pill 배지를 진행 상태 버튼과 같은 계열의 클릭 가능한 상태 컨트롤로 바꿨다.
  - 크기는 가능성 컬럼 가독성에 맞춰 진행 상태 버튼보다 약간 크게 유지한다.
  - 스타일 원칙은 진행 상태 버튼과 동일하다: 7px radius, 거의 보이지 않는 기본 border, 짧고 또렷한 shadow, hover/active 시 차선생 메인 컬러 border/glow.
  - 가능성 값은 `높음`, `중간`, `낮음`, `보류`, `확정` 목업 옵션으로 선택 가능하다.
  - 현재는 프론트 상태 override로만 반영하며, 실제 DB 필드/API 저장은 추후 연결한다.
  - 가능성 popover도 진행 상태 popover와 동일하게 외부 첫 클릭 소비 규칙을 따른다.

- 상단바 popover 동작
  - 검색, 업무 AI, 알림, 프로필 popover는 모두 동일하게 첫 외부 클릭을 닫기 전용으로 소비한다.
  - document 이벤트만으로 막는 방식은 React 클릭 흐름에서 흔들릴 수 있어, popover가 열리면 투명한 `.topbar-popover-shield`를 깔아 뒤쪽 버튼/링크/고객 행 클릭을 물리적으로 막는다.
  - AI/프로필은 기존 닫힘 animation이 있어 클릭 직후 잠깐 보일 수 있지만, 같은 클릭으로 고객 상세 이동이나 다른 상단바 액션은 실행하지 않는다.

- 페이지네이션
  - 고객 리스트는 무한 스크롤보다 페이지네이션이 적합하다고 판단했다.
  - 기본 페이지 크기는 `15`.
  - 옵션은 `15`, `30`, `50`, `100`.
  - 현재 20명 목업에서는 15명 기본 노출 + 2페이지 구조로 동작한다.
  - 검색/필터/페이지 크기 변경 시 1페이지로 돌아간다.
  - 전체 선택은 현재 페이지에 보이는 고객만 선택한다.
  - 페이지네이션 UI는 테이블 하단에 붙고, 차선생 CRM의 조용한 운영툴 톤에 맞춘다.

## 고유번호 관련 결정

- 내부 DB PK는 UUIDv7 기준이다.
- 고객에게 보이는 고객번호는 별도 business code로 관리한다.
- 고객번호는 `CU-YYMM-####`.
- 기존 디엘오토솔루션 고객번호는 `DL-YYMM-####`.
- 견적/계약/상담/출고/정산은 각각 `QT`, `CT`, `CS`, `DV`, `ST`.
- 상세 기준은 `ref/business-code-system.md`를 따른다.

## Pending Task

- 상담 접수/배분 화면에서 기존 고객 중복 문의 표시 UI가 필요하다.
- 기준은 `ref/pending-tasks.md`를 따른다.

## 현재 수정 중인 주요 파일

- `client/src/pages/CustomerManagementPage.tsx`
- `client/src/index.css`
- `client/src/data/customers.ts`
- `client/src/pages/CustomerManagementPage.test.tsx`
- `ref/business-code-system.md`
- `ref/pending-tasks.md`

## 최근 검증

- `bun run test:unit client/src/pages/CustomerManagementPage.test.tsx` 통과
- `bun run typecheck` 통과
- 2026-05-18 진행 상태/가능성 popover 외부 클릭 회귀 테스트 추가 후 `CustomerManagementPage.test.tsx` 9개 통과.
- Playwright 수동 확인: 진행 상태 popover 열린 상태 캡처 `screenshots/customer-stage-popover-open.png`, 외부 클릭 후 목록 유지 캡처 `screenshots/customer-stage-popover-after-outside-click.png`.
- Playwright 수동 확인: 검색/업무 AI/알림/프로필 popover 열린 상태에서 고객 행 첫 클릭 시 모두 `고객 관리 · 전체 보기` 유지.
- `bun run screenshot:crm` 통과. 최신 캡처: `screenshots/customer-management-1440.png`, `screenshots/customer-management-1280.png`, `screenshots/customer-management-1280-right.png`.
- 진행 상태 popover 열린 상태 캡처: `screenshots/customer-stage-popover-1440.png`.
- 가능성 popover 열린 상태 캡처: `screenshots/customer-chance-popover-1440.png`.
- `bun run lint`, `bun run build`는 아직 실행하지 않았다.

## 다음에 이어갈 만한 작업

1. 현재 페이지네이션 UI를 실제 화면에서 보고 위치/밀도/버튼 톤을 판단한다.
2. 필요하면 Playwright screenshot으로 100%/주요 viewport에서 페이지네이션과 테이블 정렬을 확인한다.
3. `진행 상태` 컬럼의 후속 신호 문구와 실제 실무 유용성을 확인한다.
4. 전체 컬럼 확정 후 고객 관리 전체 레이아웃을 새로 다듬는다.
5. 이후 Drizzle/Supabase 실제 DB 구조와 연결한다.

## 세션 인계 문서

- 2026-05-18 최신 인계문서: `/Users/jian/Documents/creativejian/mrcha/crm/ref/next-session-handoff-2026-05-18.md`

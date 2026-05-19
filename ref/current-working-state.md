# 차선생 CRM Current Working State

Last updated: 2026-05-19

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
  - 최고관리자/팀장 기준 전체 보기 순서: `선택 / 고객 / 차종·구매방식 / 진행 상태 / 계약 가능성 / 상담 메모·문의 사항 / 유입·상담 / 담당 / 관리`.
  - `계약 가능성`은 `진행 상태` 바로 뒤로 이동했다. 이유는 현재 고객 단계와 계약 전환 판단을 하나의 판단 묶음으로 스캔하는 편이 실무상 빠르기 때문이다.
  - `상담 메모`는 담당자가 직접 남기는 고객 응대/진행 맥락 메모 성격으로 본다. AI는 추후 추천/초안 보조 역할로 연결할 수 있지만, 리스트 표시값은 담당자 메모가 우선이다.
  - `상담 메모`는 리스트에서 인라인 수정 가능하다. 작은 pencil pill을 눌러 3줄 textarea로 전환하며, Enter 저장, Esc 취소, 체크 버튼 저장, X 버튼 취소를 지원한다. 현재는 프론트 상태에서만 갱신한다.
  - `AI 요약`은 상시 컬럼에서 제거하고 `관리` 컬럼의 가장 왼쪽 `AI` 힌트 버튼으로 이동했다. hover 시 차선생 메인 컬러 tooltip으로 AI 요약을 보여준다.
  - 이 변경으로 리스트 본문에서는 담당자 메모인 `상담 메모`가 주도권을 갖고, AI는 필요할 때만 확인하는 보조 정보가 된다.
  - 상담사/딜러 기준에서는 `담당` 컬럼을 숨긴다. 상담사 관점에서 담당자는 본인이므로 실무 우선순위가 낮고, 딜러 화면은 별도 설계 전까지 담당 컬럼을 노출하지 않는다.
  - 차종/구매방식 컬럼은 `모델 / 트림 / 구매방식` 3단 위계로 표시한다.
  - 긴 트림 원문은 리스트에서 축약형 `trimShort`로 보여주고, 원문은 `title`로 보존한다. 예: `26년형 가솔린 터보 2.5 하이브리드 (9인승)` -> `2.5T 하이브리드 · 9인승`.
  - 복수 차종/구매방식은 리스트에서 대표값 + `+N` pill로 표시하고, hover tooltip에 추가 목록을 보여준다. 예: `Maybach S-Class +1`, `운용리스 +1`.
  - `+N` pill 자체는 그레이/화이트 톤을 유지하고, hover tooltip만 차선생 메인 컬러 `#5836ff` 배경과 흰색 텍스트를 사용한다.

- 진행 상태 컬럼
  - 기존 `단계` 헤더는 모호해서 `진행 상태`로 변경했다.
  - 2026-05-19 기준 전체 보기에서는 기존 `상태 뱃지 / 상태그룹·시간 / 후속 신호` 3줄 구조 대신 `[1차 상태] › [2차 상태]` 2단계 진행 상태 버튼 구조를 적용했다.
  - 1차 상태값은 `신규`, `상담중`, `견적`, `차량체크`, `심사서류`, `관리중`, `상담완료`, `계약완료`, `불발` 기준이다.
  - 2차 상태값은 1차 상태에 종속된다. 예: `신규`는 `상담접수/1차부재중/지속적부재/연락해야함`, `상담중`은 `구매방식상담중/차량상담중/견적상담중`, `계약완료`는 `딜러사계약중/대리점발주중/특판발주중/배정완료/출고완료`.
  - 1차 상태 버튼을 클릭하면 1차 상태 popover가 열리고, 1차 상태를 선택하면 해당 상태의 첫 2차 상태가 즉시 반영된 뒤 2차 상태 popover가 자동으로 열린다.
  - 2차 상태 popover가 열린 동안 1차 상태 버튼과 연결 화살표도 active 톤을 유지해 두 단계가 따로 노는 느낌을 줄였다.
  - 상태 버튼의 드롭다운 chevron은 반복 테이블에서 시각 노이즈가 커서 제거했다.
  - 상태 버튼은 체크박스/관리 버튼/`+N` pill과 같은 계열의 약한 border, inset highlight, shadow로 살짝 떠 있는 느낌을 준다.
  - 진행 상태 popover는 상단바 AI/알림 popover와 같은 계열의 `12px radius`, `var(--line)` border, 깊은 shadow, 상단 꼬리, 짧은 진입 animation을 사용한다.
  - 진행 상태/가능성 popover가 열린 상태에서 외부 영역을 클릭하면 첫 클릭은 popover 닫기만 수행한다. 행/버튼/링크 같은 하위 액션은 같은 클릭에서 실행하지 않는다.
  - popover 진입 animation은 뒤쪽 테이블 텍스트가 비쳐 보이지 않도록 opacity 전환 없이 transform만 사용한다.
  - 선택 시 목업 프론트 상태에서 `status/statusGroup`이 함께 갱신된다. 아직 API 저장/히스토리 기록은 연결하지 않았다.
  - 단, 진행 상태값의 최종 명칭/분류/히스토리/권한/자동화 조건은 pending task로 보류했다. 고객 상세 페이지에서 실제 진행 상태 체계를 확정한 뒤 다시 설계한다.
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
- 2026-05-19 고객 관리 리스트 `관리` 컬럼의 AI 힌트 버튼은 모든 고객에 대해 문장형 말풍선으로 통일했다.
- AI 힌트 말풍선은 `+1` 호버 말풍선과 같은 작은 텍스트 크기를 기준으로 하며, 문장 안에서 핵심어만 굵게 처리한다. 제목/설명 2단 구조는 AI 힌트가 무거워 보여 사용하지 않는다.
- Playwright 수동 확인: 문장형 AI 힌트 호버 캡처 `screenshots/ai-hint-sentence-hongbitnari-crop.png`.
- 2026-05-19 `+1` 배지, 상담 메모 pencil 버튼, 관리 컬럼의 AI/상담/문서 버튼은 hover 시 진행 상태/계약 가능성 버튼처럼 살짝 위로 뜨는 micro interaction으로 통일했다.
- Playwright 수동 확인: `screenshots/small-button-hover-ai-hint.png`, `screenshots/small-button-hover-next-action-edit.png`, `screenshots/small-button-hover-extra-pill.png`.
- 2026-05-19 `+1` 배지는 hover tooltip이 아니라 클릭 시 말풍선이 열리고, 외부 첫 클릭은 말풍선 닫기만 수행하도록 변경했다. 고객 행 클릭으로 상세 이동이 바로 실행되지 않음을 Playwright로 확인했다.
- `+1` 배지, 상담 메모 pencil 버튼, 관리 컬럼 3개 버튼은 기본/hover border, color, shadow 토큰을 맞췄다. 이후 기본 Y 보정은 풀고, hover 이동은 크기 대비 체감이 맞도록 `+1`/pencil은 `-1px`, 관리 버튼은 `-1.75px`로 조정했다.
- 같은 작은 조작 버튼 계열의 radius도 `5px`로 통일했다.
- 상담 메모 인라인 수정 textarea는 표시 텍스트와 동일한 font-size/weight/line-height로 맞췄고, 편집 진입 시 커서는 문장 끝으로 이동한다.
- 상담 메모 텍스트는 담당자 메모 성격이므로 고객명/차종명처럼 튀지 않게 `#4f5a64`, `12px`, `font-weight: 500`으로 낮췄다. 편집 textarea도 동일 톤으로 맞췄다.
- 상담 메모 목업은 수동 줄바꿈이 아니라 자연 줄바꿈 기준으로 1~3줄이 섞이도록 조정했다. 한 줄을 최대한 가로로 채운 뒤 컬럼 폭에 따라 wrapping되며, pencil 버튼은 텍스트 길이에 끌려다니지 않도록 오른쪽 고정 흐름으로 정렬한다.
- 상담 메모 3줄 케이스는 시각 기준으로 2~3번째 줄이 위로 붙어 보여 `line-height: 1.56`으로 조정했다. 1줄 시작점은 유지하고 줄간격만 넓혀 3줄 메모가 행 안에서 더 균형 있게 차도록 한다.
- 상담 메모 첫 줄 기준선은 고객명/차종명 1열 기준과 맞추기 위해 `next-action-display`를 `translateY(1px)`로 보정했다.
- 진행상태 버튼은 버튼 배경과 내부 텍스트 중심이 모두 김민준 행 첫 줄 기준선에 맞도록 조정했다. `stage-control: translateY(-2.5px)`, 내부 span `translateY(0.5px)`. 최종 측정값: 김민준 315.25, Maybach S-Class 314.75, 견적발송 텍스트 315, 견적발송 버튼 박스 315, 상담 메모 첫 줄 315.
- 상담 메모 편집 상태에는 저장/취소/비우기 버튼을 세로로 둔다. 순서는 체크, X, Eraser이며 Eraser는 draft 내용을 빈 값으로 초기화한다. 빈 메모 저장도 허용한다.
- 편집 버튼 스택은 textarea 보라 외곽선 top과 체크 버튼 top이 정확히 맞도록 조정했다. 최종 측정값: textarea top 306, 저장 버튼 top 306.
- 편집 버튼 스택은 textarea height 68px 기준으로 저장 버튼 top, 취소 버튼 center, 비우기 버튼 bottom을 각각 textarea top/center/bottom에 맞춘다. 최종 측정값: textarea top/center/bottom 306/340/374, 저장 306, 취소 center 340, 비우기 bottom 374.
- 이후 일반 상태 시각 보정을 위해 저장 버튼은 textarea top보다 0.75px 위, 비우기 버튼은 textarea bottom보다 0.5px 아래로 조정했다. 취소 버튼은 center 기준을 유지한다.
- 편집 입력창과 버튼 3개를 합친 union 영역은 row/cell 기준 위아래 여백이 동일하도록 `next-action-editor: translateY(0.125px)`로 보정했다. 최종 gap: top 8.875px, bottom 8.875px, delta 0.
- 상담 메모 편집 상태에서 입력창/버튼 영역 바깥을 클릭하면 현재 draft를 저장하고 편집을 종료한다.
- 편집 버튼 hover 색상은 저장 green, 취소 red, 비우기 amber로 의미를 분리했다.
- 고객 관리 전체 보기 컬럼 폭을 1차 정리했다. 앞쪽 컬럼의 헐거운 가로 리듬을 줄이고 상담 메모 공간을 늘리기 위해 `고객 140`, `차종·구매방식 122`, `진행 상태 100`, `상담 메모 256` 기준으로 조정했다.
- 2026-05-19 고객 관리 전체 보기 컬럼 폭을 다시 정리했다. 최종 고정값이 아니라 단계별 실험값이므로 이후 실제 화면 리듬 기준으로 계속 재조정한다.
- 2026-05-19 계약 가능성을 진행 상태 바로 뒤로 이동하면서 컬럼 폭을 다시 조정했다. 이후 좌우 프레임 20px 기준을 유지하면서 전체 컬럼 리듬을 다시 잡기 위해 고객/차종/진행/가능성/유입/담당은 `clamp()` 기반으로 반응형 분산하고, 상담 메모는 남는 폭을 받되 독점하지 않도록 조정했다.
- 진행 상태와 계약 가능성은 판단 묶음으로 붙이고, 상담 메모는 왼쪽 padding 14px로 버튼형 컬럼과 텍스트 컬럼이 붙어 보이지 않게 했다.
- `계약 가능성`은 헤더와 본문 버튼 모두 왼쪽 정렬로 맞췄다. 가운데 정렬은 진행 상태와 상담 메모 사이에서 버튼이 섬처럼 떠 보여 사용하지 않는다.
- 이후 계약 가능성 셀의 좌측 padding을 0으로 줄여 기준점을 당겼고, 진행 상태 컬럼 최소 폭을 다시 확보해 긴 2차 상태 버튼과 계약 가능성 버튼이 붙지 않게 했다. Playwright 기준 진행 상태 2차 버튼 오른쪽과 계약 가능성 버튼 왼쪽 사이 최소 간격은 1440px/1792px에서 `20.78px`, 2048px에서 `40.58px`이다.
- 임시 테스트로 넣었던 `계약 가능성` 헤더/본문 `translateX(-10px)`는 셀 자체를 왼쪽으로 밀어 `계약 가능성`과 `상담 메모 · 문의 사항` 헤더 사이에 흰 공백을 만들었으므로 제거했다. Playwright 직접 측정 기준 `head-chance.right`와 `head-action.left`의 gap은 `0px`이다. 헤더/본문 간격은 transform이 아니라 컬럼 폭과 padding으로 조정한다.
- 진행 상태 2차 버튼은 계약 가능성 버튼과 같은 높이/패딩/radius/shadow/텍스트 보정 계열로 맞췄다. 색상만 진행 상태 값에 따라 유지한다.
- 진행 상태 1차 버튼도 2차/계약 가능성과 같은 높이, 글자 크기, 글자 굵기, 기본 농도, 좌우 padding으로 맞췄다. 색상 체계는 추후 실제 상태값 확정 후 다시 판단한다. Playwright 캡처: `screenshots/customer-stage-button-consistency-1920.png`, `screenshots/customer-stage-button-consistency-1440-after-width.png`.
- 1차 버튼 padding을 키우면서 좁은 화면의 긴 2차 상태값이 계약 가능성과 맞닿는 문제가 있어, 진행 상태 컬럼을 `clamp(185px, 10vw, 210px)`, 계약 가능성 컬럼을 `clamp(82px, 5vw, 100px)`로 조정했다.
- 상담 메모와 유입·상담 사이가 붙어 보이지 않도록 `상담 메모` 셀 오른쪽 안전 여백을 34px로 늘렸다. Playwright 2048px 측정 기준 상담 메모 pencil 오른쪽과 유입·상담 텍스트 사이 간격은 30px에서 44px로 개선했다.
- 뒤쪽 컬럼은 `유입·상담/담당/계약 가능성/관리`를 압축해 담당-계약 가능성 사이의 과한 빈 공간을 줄였다. Playwright 2048px 측정 기준 담당 텍스트와 계약 가능성 버튼 사이 간격은 140.42px에서 119.28px로 줄었다.
- 고객 리스트 좌우 프레임 기준은 선택 체크박스 외곽선 기준 `왼쪽 20px / 오른쪽 고객명 시작까지 20px`, 관리 마지막 버튼 외곽선 기준 `오른쪽 20px`로 맞췄다. 테이블은 화면 폭을 채우는 `width: 100%` 흐름을 유지하고, 선택 컬럼 `55px`, 관리 컬럼 `114px`는 고정한다. 고객/차종/진행/가능성/유입/담당 컬럼은 `clamp()`로 넓은 화면에서 함께 늘어나고, 상담 메모 컬럼은 나머지 폭을 받되 과도하게 독점하지 않게 조정했다. Playwright 측정 기준 1440px/1792px/2048px 모두 좌우 프레임 세 값이 `20px`이다.
- 컬럼 리듬 재조정 후 실제 폭: 1440px 기준 고객/차종 `158.4px`, 진행 `185px`, 가능성 `82px`, 상담 메모 `201.6px`, 유입/담당 `100.8px`, 관리 `114px`; 2048px 기준 고객 `220px`, 차종 `225.3px`, 진행 `204.8px`, 가능성 `100px`, 상담 메모 `558.2px`, 유입/담당 `143.4px`, 관리 `114px`. 2048px 테이블 캡처: `screenshots/customer-column-rhythm-2048.png`.
- 최신 컬럼 밸런스 캡처: `screenshots/column-balance-3-1792.png`, `screenshots/column-balance-3-2048.png`.
- 진행 상태는 전체 보기의 모든 고객에 2단계 버튼 preview를 적용했다. 표시 구조는 `[1차 상태] › [2차 상태]`이며 예시는 `[견적] › [발송완료]`, `[상담중] › [구매방식상담중]`, `[계약완료] › [출고완료]`이다.
- 1차 상태가 `신규`이고 2차 상태가 `상담접수`인 고객은 2차 `상담접수` 버튼 내부 오른쪽에 작은 teal-green `NEW` pill을 표시한다. 행/고객 컬럼 배경색은 건드리지 않고 진행 상태 안에서만 신규 접수 신호를 보여준다. Playwright 확인 기준 현재 목업에서 1건만 표시되며, 진행 상태-계약 가능성 최소 간격은 유지된다. 캡처: `screenshots/stage-new-badge-secondary-green-1440.png`.
- 현재 1차 상태 후보는 `신규/상담중/견적/차량체크/심사서류/관리중/상담완료/계약완료/불발`이다.
- 1차 상태 버튼을 클릭하면 1차 상태 popover가 뜨고, 1차 상태를 선택하면 해당 1차 상태의 첫 2차 상태가 반영된 뒤 2차 상태 popover가 자동으로 열린다.
- 2차 상태 후보 예: `상담중` 선택 시 `구매방식상담중/차량상담중/견적상담중`, `계약완료` 선택 시 `딜러사계약중/대리점발주중/특판발주중/배정완료/출고완료`.
- 진행 상태 1차/2차 popover는 흰 박스형 드롭다운에서 버튼형 세로 리스트로 전환했다. 다만 버튼만 떠 있으면 아래 행의 상태 버튼들과 섞여 보이므로, 얇은 불투명 white surface와 shadow를 둔 로컬 컨테이너 안에 버튼 리스트를 배치했다. 1차 popover는 1차 버튼 left 기준, 2차 popover는 2차 버튼 left 기준으로 열린다. 2차 옵션은 `statusButtonClass(value, customer.statusGroup)`을 적용해 실제 상태 컬러를 유지한다. Playwright 확인 기준 popover surface는 `rgb(255, 255, 255)`, 2차 `재고확인중/재고있음/대기필요`은 yellow, `재고없음`은 red로 표시된다. 캡처: `screenshots/stage-primary-surface-popover-1440.png`, `screenshots/stage-secondary-surface-popover-1440.png`.
- 이후 진행 상태와 계약 가능성 popover surface를 모두 연회색 트랙형으로 통일했다. 기준은 `background #f7f7f6`, `border #dededb`, `12px radius`, 낮은 shadow이며, 옵션 버튼 색상은 기존 상태 컬러를 유지한다. Playwright 확인 기준 진행 상태/계약 가능성 popover surface는 `rgb(247, 247, 246)`이다. 캡처: `screenshots/stage-primary-track-popover-1440.png`, `screenshots/stage-secondary-track-popover-1440.png`, `screenshots/chance-track-popover-1440.png`.
- 진행 상태/계약 가능성 버튼과 popover option은 사이드메뉴/프로필 segmented button 계열과 일관되도록 soft elevation을 강화했다. 위치와 크기 값은 유지하고, 배경색을 한 단계 선명하게 하고 shadow를 `0 1px 1.5px + 0 4px 8px + inset highlight` 계열로 조정했다. hover/active는 보라 ring과 더 강한 elevation을 사용한다. 캡처: `screenshots/status-buttons-elevated-1440.png`, `screenshots/chance-popover-elevated-1440.png`, `screenshots/stage-popover-elevated-1440.png`.
- 2단계 진행 상태 popover는 기존 `.primary` 전역 버튼 클래스와 충돌하지 않도록 `level-primary/level-secondary` 클래스를 사용한다.
- Playwright 수동 확인: `screenshots/customer-stage-all-two-step-1440.png`, `screenshots/customer-stage-primary-popover-1440.png`, `screenshots/customer-stage-secondary-popover-connected-1440.png`.
- 2026-05-18 진행 상태/가능성 popover 외부 클릭 회귀 테스트 추가 후 `CustomerManagementPage.test.tsx` 9개 통과.
- 2026-05-19 진행 상태 1차/2차/계약 가능성 버튼을 빠르게 바꿔 누를 때 첫 클릭이 닫기 전용으로 소비되는 문제를 수정했다. 열린 popover의 document `pointerdown` 닫기 로직이 `.stage-control`, `.chance-control`, `.extra-count-pill` 내부 클릭은 외부 클릭으로 보지 않게 했고, 가능성 버튼 클릭 시 열려 있던 1차/2차 진행 상태 popover도 명확히 닫는다.
- 위 클릭 충돌 회귀 테스트를 추가했다. 검증: `bun run typecheck`, `bun run test:unit client/src/pages/CustomerManagementPage.test.tsx` 11개 통과. Playwright 5173 수동 자동화 기준 1차 진행 상태 -> 계약 가능성 -> 1차 진행 상태 -> 2차 진행 상태 전환이 모두 한 번 클릭으로 열렸다.
- 2026-05-19 계약 가능성 `확정`은 진행 상태 1차 `계약완료`에 종속되는 업무 규칙으로 정했다. 1차 진행 상태가 `계약완료`가 되면 2차 상태값과 무관하게 계약 가능성은 자동으로 `확정` 표시/저장된다. 반대로 1차 진행 상태가 `계약완료`가 아닌 고객에서 계약 가능성 `확정`을 직접 클릭하면 값은 바뀌지 않고 기본 계약 가능성 버튼 오른쪽에 로컬 안내를 붙인다. 안내는 AI 힌트/+1 말풍선과 같은 메인 보라 배경, 흰 원 안 메인컬러 `!` 아이콘, `계약완료 시`만 큰 bold로 표시한다. 문구는 `계약완료 시 자동 확정됩니다`이다. 검증: `bun run typecheck`, `bun run test:unit client/src/pages/CustomerManagementPage.test.tsx` 13개 통과, Playwright 5173 확인 및 캡처 `screenshots/chance-inline-notice-purple-1440.png`.
- 2026-05-19 상담 메모 pencil 버튼과 관리 컬럼 3개 버튼은 진행 상태/계약 가능성 버튼과 시각 결을 맞추기 위해 보라 tint action button으로 조정했다. 기본값은 `#f4f1ff` 배경, 메인컬러 아이콘, 보라 22% border, soft purple shadow다. hover는 `#ece8ff`와 보라 ring/shadow로 강화한다. 편집 상태의 저장/취소/비우기 버튼은 의미색을 유지하도록 별도 처리했다. Playwright 캡처: `screenshots/action-buttons-purple-tint-1440.png`.
- 2026-05-19 사이드메뉴는 100% 브라우저 기준 조금 크게 보여 1차 compact density를 적용했다. 채택값: 펼친 폭 `234px`, row height `38px`, icon `18px`, nav font `13px`, nav gap `10px`, nav padding `0 12px`, visual gap `22px`. 226/230/232px도 테스트했지만 하단 상담 철학 문구 줄바꿈 때문에 234px로 유지한다.
- 2026-05-19 사이드바 접기/펼치기 애니메이션은 `display: none`으로 텍스트/하단 영역이 즉시 사라지며 끊겨 보였으므로 opacity/max-width/max-height 전환으로 바꿨다. 이후 전환이 조금 느리고 접힘 시 내부 사이드바가 먼저 `64px`로 튀는 2단계 느낌이 있어, shell grid 전환을 `0.18s cubic-bezier(0.2, 0.8, 0.2, 1)`로 빠르게 조정하고 `.sidebar.collapsed width: 64px` 고정값은 제거했다. 현재 사이드바 폭은 grid column을 따라 같이 움직인다.
- 2026-05-19 접힌 사이드바는 더 명확한 아이콘 레일 느낌을 위해 폭을 `64px`로 줄였다. 접힌 상태 padding은 `6px`, nav button은 `38px`, 로고 flex gap은 `0`으로 조정해 로고/아이콘/구분선이 같은 중앙축에 오도록 했다. Playwright 측정 기준 sidebar center `32px`, brand/button/separator center `31.5px`이며 캡처는 `screenshots/sidebar-collapsed-64-centered-1440.png`, 전환 확인 캡처는 `screenshots/sidebar-transition-width-follow-grid-1440.png`.
- 2026-05-19 사이드메뉴 2차 스타일은 여기서 잠정 완료/동결했다. 최종 주요값은 브랜드 서브카피 `이것은 CRM인가 혁명인가` + 하단 철학과 같은 `mark` 형광펜, 기본 메뉴 `13px`, 서브 메뉴 `11.5px/400`(active `550`), 역할 탭 `11.5px/750`, 역할 탭 padding/gap `4px`, 상담 철학 본문 기존 유지, 기본 아이콘 `17px`, 고객 상세 아이콘 `18px translateY(-2px)`, 견적 관리 아이콘 `19px margin-left:-2px translateY(-1px)`. 당분간 사이드메뉴 전체 스타일은 만지지 않고, 나중에 실제로 눈에 거슬리는 지점이 생기면 다시 연다.
- Playwright 수동 확인: 진행 상태 popover 열린 상태 캡처 `screenshots/customer-stage-popover-open.png`, 외부 클릭 후 목록 유지 캡처 `screenshots/customer-stage-popover-after-outside-click.png`.
- Playwright 수동 확인: 검색/업무 AI/알림/프로필 popover 열린 상태에서 고객 행 첫 클릭 시 모두 `고객 관리 · 전체 보기` 유지.
- `bun run screenshot:crm` 통과. 최신 캡처: `screenshots/customer-management-1440.png`, `screenshots/customer-management-1280.png`, `screenshots/customer-management-1280-right.png`.
- 진행 상태 popover 열린 상태 캡처: `screenshots/customer-stage-popover-1440.png`.
- 가능성 popover 열린 상태 캡처: `screenshots/customer-chance-popover-1440.png`.
- `bun run build` 통과.
- `bun run lint` 통과. 기존/잔여 경고 6개는 있음: Topbar hook dependency 2개, shadcn UI fast refresh 2개, CustomerManagementPage hook dependency 2개.

## 다음에 이어갈 만한 작업

1. 현재 페이지네이션 UI를 실제 화면에서 보고 위치/밀도/버튼 톤을 판단한다.
2. 필요하면 Playwright screenshot으로 100%/주요 viewport에서 페이지네이션과 테이블 정렬을 확인한다.
3. `진행 상태` 컬럼의 후속 신호 문구와 실제 실무 유용성을 확인한다.
4. 전체 컬럼 확정 후 고객 관리 전체 레이아웃과 컬럼 밀도를 새로 다듬는다. 이때 `상담 메모` 텍스트 위계도 함께 재검토한다.
5. 이후 Drizzle/Supabase 실제 DB 구조와 연결한다.

## 세션 인계 문서

- 2026-05-19 최신 인계문서: `/Users/jian/Documents/creativejian/mrcha/crm/ref/next-session-handoff-2026-05-19.md`
- 2026-05-18 최신 인계문서: `/Users/jian/Documents/creativejian/mrcha/crm/ref/next-session-handoff-2026-05-18.md`

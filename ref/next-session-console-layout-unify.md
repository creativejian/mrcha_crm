# 다음 세션 인계 — 고객 관리 하위 mode 콘솔 레이아웃 통일 (브레인스토밍 중단, 재개 대기)

Last updated: 2026-07-15 (세션 0715-rest-refactoring · 유슨생 이동으로 중단)

## 상태
- **brainstorming 스킬 진입 → Visual Companion "목업 띄워가며" 승인 받음 → 유슨생 이동으로 보류.**
- 재개 시: `superpowers:brainstorming` 다시 열고 Visual Companion(브라우저 목업)으로 rail 배치안부터. 그 뒤 spec(`ref/specs/2026-07-15-*`) → plan → 구현.

## 무엇을 하려는가
전체 보기(`mode="all"`)만 콘솔 문법(1줄 rail + 흰 헤더·연회색 바디 테이블 서피스)이고, **나머지 5개 mode(consulting·contract·delivery·settlement·hold)는 구식 2줄 rail + 회색 전역 헤더**다. 이 5개를 전체 보기 시각 문법으로 통일한다.

## 확정된 결정 (유슨생)
1. **5개 mode 전부** 통일 (사이드바: 상담 필요·계약 관리·출고 관리·출고 정산·보류/이탈). delivery/settlement는 데이터 프로토타입이지만 껍데기는 같이 통일.
2. **필터/select 항목은 각 mode 그대로 유지 — 시각(껍데기)만 통일.** 전체 보기의 계약가능성/관리상태 필터를 다른 mode에 억지로 넣지 않음. → "mode별 필터 세트를 어떻게 나눌지" 고민 자체가 사라짐.
3. **죽은 mock select 3개(담당자별 보기·상담상태별 보기·긴급순으로 보기, `:971-973` 옵션 1개·onChange 없음) 유지.** 지우지 않음 — 나중에 기능 붙일 자리. 단 시각은 콘솔 톤으로.

## SSOT 원칙 (유슨생 명시 강조 — 반드시 준수)
- 지금 문제의 뿌리 = `isConsole = mode === "all"`(`:813`)로 갈린 **컨트롤 rail JSX 두 벌**(`:886~976` 콘솔용/구식용). 통일 = 두 벌을 **한 벌로 수렴**. 구식 rail에 콘솔 스타일 복붙해 세 번째 변형 만들지 말 것.
- 테이블 서피스는 **어제 만든 SSOT 재사용** — `console-table`/`console-table-scroll`(controls.css, 4-A). 새 CSS 만들지 않음.
- 필터 렌더는 `renderConsoleFilter`(`:825`) 하나로 수렴 — 구식 `<select className="select">`(`:929-940`)와 공존 제거. 죽은 select 3개도 같은 렌더러 태워 시각 자동 일치.
- CSS 클래스도 mode별 예외 신설 없이 기존 콘솔 클래스 공유.

## 발견된 실버그 (통일하면 자동 해소)
- **담당자 변경 팝오버가 비콘솔 mode에서 깨져 인라인 텍스트로 흐름**(스크린샷 실측). 원인 = `.advisor-change-confirm`/`.advisor-change-wrap` 전 규칙이 `.customer-console-headbar` 하위로만 스코프됨(`customer-console.css:793~969`). 비콘솔은 `.list-headbar`라 스타일 0 → position:absolute 없이 블록으로 흐름. #216(일괄 담당자 변경)이 콘솔 전제로만 짜인 것. 콘솔 headbar 클래스가 붙으면 자동 해결.

## brainstorming에서 정할 남은 설계 결정
1. **1줄 rail 배치**: 컨트롤 많은 mode(계약관리 = 검색+select 6개+버튼 3개) 1줄 밀도 처리. 좁은 화면 줄바꿈/랩 규칙.
2. **select 톤**: 죽은 select 3개 + 진행상태/담당자 select를 `renderConsoleFilter` 버튼형으로 흡수할지, 네이티브 `<select>` 유지하고 콘솔 톤만 입힐지. (담당자별 보기류는 나중에 옵션 여러 개 붙을 실 select라 네이티브가 나을 수도 — 목업으로 비교.)
3. **[전체 N명] vs TOTAL 표기 통일** 여부.
4. **클래스 리네임 여부**: `customer-console-*` 이름이 전 mode 공용이면 "console(=전체보기)" 의미 어색. 이름 유지(공용화) vs `customer-list-rail` 등 중립 리네임. **리네임은 CSS 클래스 대량 변경 → 시각 회귀 0 기계 증명(verify-dead-css.sh 방식) 필요한 별개 비용** — YAGNI로 이름 유지 권장 후보.

## 참고 코드 위치
- 렌더 분기: `client/src/pages/CustomerManagementPage.tsx:883~1145` (`isConsole` 게이트)
- 헤더/컬럼 정의: 같은 파일 `:48-64` (mode별 heads/columns)
- 콘솔 필터: `:817` consoleFilterOptions, `:825` renderConsoleFilter
- 콘솔 CSS: `client/src/styles/customer-console.css` (rail·headbar·팝오버), `controls.css` (console-table SSOT)
- Safari select 함정 준수: controlled select는 onChange+onInput 병행(`lib/select-bind.ts` bindSelect가 이미 처리 — 통일 시 계속 사용).

## 검증 예산 (구현 시)
- CSS/레이아웃 변경: typecheck·lint·unit·build + **격리 스택 브라우저 스모크**(5 mode 각 rail·테이블·담당자 팝오버 스크린샷) + 클래스 리네임 시 빌드 CSS 계산값 대조.
- 실행: subagent-driven이면 태스크별 2단계 리뷰.

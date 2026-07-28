# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-07-28

## 지금 상태

**main 전량 green · 브랜치 0.** 머지 11건(`#372`~`#381`+main 직접 1) · 마이그 3건(0039 `dealer_profiles`
· 0040 `dealer_trim_discounts` · 0041 `catalog_discount_adoptions`) · 4종 0 · unit **1207** · pure 259 ·
build · 실 DB 755 · `check:residue` 0. **딜러 할인 = 입력→채택 완결**, 로컬 실기 완료. ⚠️ **prod 확인 0회.**

## 직전 세션 요약 (07-27 밤 ~ 07-28 · 슬라이스 C 완결 + 실기 후속 2건)

- **`#381`(07-28 실기 후속)** ⓐ**감사가 거짓을 말했다** — TrimEditPanel 직접 입력이 감사를 안 남겨
  (spec §3.4 미구현) 팝오버가 옛 딜러 채택을 출처로 계속 보여줬다. PATCH가 **바뀐 할인 필드만**
  감사(`source_dealer_user_id = NULL`) + 갱신과 한 트랜잭션. 배지 "새 제안"→"재채택 필요".
  ⚠️ **배선은 실기가 유일 검증**(catalog PATCH 라우트 테스트가 레포에 0건 — 픽스처 트림은 앱에
  유령을, 실 트림 수정은 스탬프 오염을 만든다). ⓑ**천단위 커서 유실** 8곳 — 커서 앞 **숫자 개수**를
  보존해 복원(문자 인덱스는 콤마가 이동해 불가). 핸들러 팩토리 금지(`react-hooks/refs`).
- **`#379`** 딜러 화면 브랜드 열 제거(선택지 1개짜리 장식) → 헤더 `"BMW 차량 관리"`. **`#380`** 슬라이스 C
  전량 — `catalog_discount_adoptions`(필드 단위 감사)·`listModelProposals`/`adoptDealerProposal`·admin 라우트 2개·팝오버.
- 🔴 **딜러에게 확정 할인 비노출**(구현 중 결정 — spec §7.1 뒤집음). 차단은 **서버**(`src/lib/
  dealer-visibility.ts`) — 새는 경로가 둘이었다(`/api/catalog/trims`·`/api/vehicles/trims/:trimId`).
  할인변경일도 비우고 딜러 화면에선 **열째 제거**.
- ⚠️ **spec §2 근거 정정**: "확정 할인은 앱에서 고객에게 공개되는 값"이 **거짓**이었다 — 앱 사용처는
  `screens/admin/trim_list/` 2파일뿐(**고객 화면 0건** 실측), 고객엔 계산 결과만 간다. 이 정정이 정책을
  뒤집었다(감출 실익 + 앱 우회 경로 없음). 브랜드 스코프는 반대로 클라 차단 유지.
- **계획 이탈 5건**(근거는 `#380` 본문): 금액 인자 제거(감사 위조 차단) · 테스트 전량 트랜잭션
  롤백 · 조회 트림→모델 단위 · **자격 상실자 채택 서버 차단**(TDD RED로 실제 뚫림 확인) · 팝오버 별 파일.
- **잔재 그물 확장**: `check:residue`가 딜러 3테이블을 안 봐 고아 제안 1행에도 "없음 ✅"이라 답했다 →
  **고아 판정**. 채택 감사만 report-only(`previous_amount`가 되돌리기 근거) + 되돌리기 SQL 자동 생성.
- **변이 검증**: `requireRoles` 제거 시 `dealer GET→200`(남의 제안 열람)·`POST→403` → **GET의
  유일 방어선이 requireRoles**(dealerWriteGate는 쓰기만 본다).
- ⚠️ **`dev:api`는 watch가 없다** — 07-27에 두 번 밟았다(브랜드 404 · 라우트 404). 백엔드 파일
  수정 후 **반드시 `bun dev` 재시작**. 증상은 매번 "기능이 없는 것처럼 보임"이라 오진하기 쉽다.

## ▶ 다음 — 미확정

**"CRM 이어가자"면 먼저 이 셋 중 택1을 물을 것**(코드 작업은 남은 게 없다): ①채택 되돌리기
(undo — `previous_amount` 있음) ②제안 도착 알림 배지("대기 N건") ③조직 화면 [저장] 버튼 ↔ 딜러 셀
자동 저장 톤 통일(유슨생 판단 대기)

## 대기

**prod(유슨생)** = `#379`~`#381` 눈 확인 1회(로컬만 검증). **판단(유슨생)** = 위 ③ · `dev:api
--watch` 도입(실 DB 커넥션 재수립 트레이드오프). **이사님** = ⓐBMW 523d(`MC070526001`)에 **자사
5,300,000(관리자 직접)·제휴 6,000,000(딜러 채택)이 실제로 들어갔다**(실기 산물·유지 판단 — 고객
견적에 반영) ⓑspec §7.1 뒤집힘 ⓒ`ref/director-pending-confirmations.md` **16건**.
**제프** = B(iM `quotedVehiclePrice`·할인·보조금) · D(`catalogPrice`) · ⑦. ⚠️ B 전까지 iM+할인 조합 금지.

## Boot

`AGENTS.md` → 이 파일 → `git status --short --branch` · `git log --oneline -5`. 더 필요하면
딜러 건 = `ref/{specs,plans}/2026-07-27-crm-dealer-*` / 과거 = `ref/session-archive.md`.

## 세션 마무리 규칙

이 파일은 **교체**(누적 금지, 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인 시 등재 없이 박제** · 이사님 확정
설계를 뒤집는 건은 등재). **항목 신설 시 그 파일 롤업 2곳도 함께 갱신.**

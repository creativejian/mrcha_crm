# Mr. Cha CRM Active Session Brief

> **자동 로드 · 60줄 이하 유지**(AGENTS.md). 과거 로그 = `ref/session-archive.md` · 지속 결정 = `AGENTS.md` · 설계 = `ref/specs/*` · 장기 상태 = `ref/current-working-state.md`.

Last updated: 2026-08-05

## 지금 상태

main 전량 green(CI 8단계). unit **1437** · pure **290**. 정산 축 종결 후 `#451`~`#459` 완료
(팝오버 분리 · mc-master UX 2 · 배지 축 5 + 조회 합치기). ✅ **앱 팀 회신·제약 적용 완료** —
`catalog.trims`가 `(model_id, name, model_year)` UNIQUE NULLS NOT DISTINCT다(막혀 있던 트림
등록이 열렸다. 상세 = `ref/2026-08-05-app-trim-model-year-unique-request.md`).

## ▶ 다음

- ⚠️ **새 CI 그물 = `delete-where-guard`**(`#460`) — 파기 쿼리 `.delete(테이블)`은 **`.where()` 필수**다.
  정당한 전량 삭제는 그 파일 `ALLOW`에 사유와 함께 등록해야 CI pure가 초록이 된다(정규식·SKIP으로 우회 금지).
- **잔여 2건(머지는 끝났다 — 실행·육안만)**: ⓐ**김지운(`jiandolce@gmail.com`) 탈퇴 테스트 미실행**
  (견적 20·**앱카드 19** — 카드 회수 경로 검증) ⓑ`#445` 배너 **육안 미확인**. **ⓐ를 하면 ⓑ가 딸려 온다**.
- **🔴 시범 고객·풀세트 시드 재지정**(상세 드로어 작업의 선행 — 김민준 삭제로 공백). **이사님 결정 영역**.
- ⚠️ **트림 등록 후 "고유번호 할당" 실행**이 운영 절차다(INSERT만으론 mc_code가 NULL = 파트너 비교에서
  빠진다). 미부여 **198/1869**(08-06 실측 · **차단 요인 0건** = 지금 실행하면 전부 부여된다).
- 리팩토링 대기 후보 없음(`#451`로 소진). 다음 큰 파일은 트리거가 없어 착수하지 않는다.
- 🟡 **보류 = 버전 표시·릴리스 체계**(2026-08-06 유슨생 "고민 좀 더"). **설계는 다 나와 있다** —
  `ref/plans/2026-08-05-crm-versioning-release.md`(뒤집힌 경위·조사·대시보드 체크리스트). 재개 시
  **처음부터 다시 논의하지 말 것.** 요지: 배포를 **태그**로 옮겨 prod 코드 = 화면 버전 일치 ·
  Workers Builds는 태그 미지원이라 **Actions `wrangler deploy`** · 스테이징 없음(로컬 확인).

## 직전 세션 (08-06 · 유슨생) — 배치 16 감사 + 수정 이행(`#460`)

- **배치 15 이후 239 PR**이 쌓였고 트리거 ⓐ실데이터 ⓑ외부계약 ⓒ무검증이 **셋 다** 걸려 착수.
  경량 정책대로 **9에이전트**(정합성 3 · 변이 2 · 실측 1 · 적대 검증 3), 변이는 worktree 격리.
  판정 = **CONFIRMED 1 · ADJUSTED 4 · REFUTED 1 · 하 12**. 메인 워킹트리 무손상(배치 14 오염 재발 0).
- 🔴 **진짜 발견은 개별 결함이 아니라 CI 구조다** — 권한·파기·돈의 **서버 그물이 전부 `test:server` 전용**
  (db-bound registry)이라 CI에서 안 돈다. **`WHERE` 절을 지운 변이 3건이 CI 8단계를 전량 통과**했다.
- **적대 검증이 제 역할을 했다**: canonical_name **상→하~중 강등**(실증 피해 0·원인 귀속 71→32 과장) ·
  정산 탭 지적 **REFUTED**(이사님 항목 31의 선택지와 동일) · app_user_id는 **앱 계약 아님**(인용 절 부존재).
- 유일한 실동작 결함 = **B 보존 고객 재연결 시 파기**(CONFIRMED). 앱 회신 §8이 재연결을 **정상 경로로 명시**해
  "도달 불가" 반박이 실패했다. 현재 노출 0(B 분류 미사용).
- **`#460` 수정 6항목 이행 완료** — 항목마다 **변이를 주입해 그물이 실제로 빨개지는지** 확인했다(③④는
  전에 통과하던 게 이제 RED). `test:server`는 건드린 3파일만 선별 실행 후 `check:residue` 잔재 0.
  ⚠️ 작업 중 정정 둘: tripwire는 상 3건 중 **2건**만 커버(select 경로는 ①이 코드로 막음) · 정산 섹션을
  통째로 조건부 렌더하면 **팝오버 높이가 변해 위치가 튄다**(→ `display:contents` fieldset). `#459`는 archive로.

## 대기

**이사님** = `ref/director-pending-confirmations.md` **18건**(항목 14·16~32 — **31·32 신설**:
정산 목록 대상 기준=계약 확정일 / 열 이름 "실입금액". 같은 화면이라 **묶어서** 여쭐 것) + Supabase
**"EXCEEDING USAGE LIMITS" 배지**(08-01) 플랜 + **D+5 최악 6일차** SLA 해석.
💡 회신 때 **🟡 하드 삭제 확장(`#440`)을 항목 28**(AI 기록에 번호 잔존)**과 묶을 것** — 같은 축·미등재.

## Boot

`AGENTS.md` → 이 파일 → `git status -sb` · `git log --oneline -5`. 상세: 정산 = spec §6a · 보존 계약 = AGENTS.md.

## 세션 마무리 규칙

**교체**(누적 금지 · 이전 요약은 `ref/session-archive.md` 맨 위로). 행위 변경은
`ref/director-pending-confirmations.md` 등재(**유슨생 현장 승인은 등재 없이 박제** · 이사님 확정
설계를 뒤집는 건만 등재 · 신설 시 그 파일 롤업 2곳도). 상세 규칙 = AGENTS.md "Handoff Documents".

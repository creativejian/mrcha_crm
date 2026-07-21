# 리팩토링 배치 12 — 감사·판정·이행 SSOT 초안 (2026-07-21)

**범위**: 배치 11 이후 미감사 = #299(계약 전환 넛지)·#300(견적 쓰기 권한)·#301(화면 role scope)·#302(인박스 게이트)·`dec583b`(달력 토글) — 코드 파일 23(+AGENTS.md 1줄), +1,033/−134. 특징 = 5건 중 3건이 권한/게이트 축.
**방법**: 관례 — 기준선 재실측(typecheck 0·lint 0·server 622·unit 989·build green) → 3앵글 병렬 감사(A 서버 게이트·B 클라 UI·C 크로스커팅) → 전건 적대 검증 3명(V1 A축 변이 실행·V2 B축 시나리오 반박·V3 이행안 설계 비교) → 오케스트레이터 ground-truth 스팟(C 3건·A#1/A#2 인용·B#5 — 선행 수행) → 판정 → PR 이행.
**신성 규칙 6종(앵글 C 전수)**: import 경계 clean(신규 1건 = quote-write-access, 등재 확인)·Safari select clean(신규 select 0)·fixture registry clean(CU-QWACC-·CU-RSCOPE- 선등록)·knip 7/9 무드리프트·[skip ci] clean(feature 5커밋 토큰 0)·문서 해시/PR 대조 일치.

## 판정 (후보 병합 11건 — CONFIRMED 8 · ADJUSTED 3 · REFUTED 0)

### 클러스터 K1: #302 전면 게이트의 드로어 부수 피해 (A#1+A#2+B#2+C#1 병합) — **중 CONFIRMED**
- K1-a `GET /api/quote-requests/:id`(프리필 단건) 403 → staff 본인 담당 앱 유입 고객의 "견적 작성/추가 작성/견적 보기 폴백/?quoteRequest 딥링크" 사망. #300 D-4②와 충돌.
- K1-b `DELETE /api/consultations/:id`(dismiss) 403 → 드로어 상담신청 카드 X가 낙관 제거→롤백+실패 토스트.
- K1-c `fetchAppQuoteRequestsCached(true)` 무catch 2곳(useQuoteList:214·useQuoteWorkbench:1403) → staff unhandled rejection 노이즈.
- 뿌리: 인박스 라우터 2개에 인박스 아닌 드로어 소비처 3개가 살고 있었음(미발견 소비처 — #302 결정 자체는 불변).
- **판정·이행 = V3 안 ②(라우트 이사) 채택**: `GET /:id/quote-requests/:reqId`·`DELETE /:id/consultations/:consultId`를 customers 라우터에 신설(#301 스코프 게이트 자동 편입 + 소유권 WHERE = 요청/상담 user_id == 그 고객 app_user_id) — 구 탑레벨 라우트 2개 폐기(물리 콜사이트 각 1곳 실측·인박스 소비 0). 안 ①(스코프-인지 예외)은 전면 게이트 불변식 즉시 완화+제3의 판정 지점 신설이라 기각, 안 ③(클라 숨김)은 sourceQuoteRequestId 승격 프로버넌스 파이프라인 포기(D-4② 후퇴)라 기각. dismiss의 staff 개방(=#302 이전 원복)은 pending 항목 16에 한 줄 병기.

### B#1: 넛지 상태 잔존 (중) — **CONFIRMED (V2: a·b·c 전 시나리오 반박 실패)**
- 클리어 경로 3곳뿐(외부클릭·Escape·유지) — 트리거 토글·팝오버 내 타 액션·해제 분기·deleteQuote에서 잔존.
- 파생: (a) editorOpen OR 잔존 → Escape 드로어 닫기 무음 차단(트리거 토글 닫기 = 일상 경로·리스너까지 해제돼 회복 불가) (b) 해제 확인과 넛지 동시 렌더(독립 조건 형제 JSX) → 해제 후 넛지 생존 → contracting 0인데 계약완료 전이·삭제까지 가면 죽은 id로 editorOpen 영구 true (c) 행 전환 후 스테일 재등장(+라이브 상태 문구 자기모순).
- 이행(V2 교정): 클리어 한 줄 산개가 아니라 **팝오버 닫힘/행 전환에 넛지(+기존 downgrade) 동반 클리어를 구조로**(setOpenQuoteActionId 래퍼) + confirmContractDecision 해제 분기 클리어 + deleteQuote 클리어. B#6 테스트 3종 동반.

### 하급 (판정 대기 포함)
| # | 판정 | 근거 요약 | 이행 |
|---|---|---|---|
| A#3 | CONFIRMED 하 | V1 프로브 재실측: 정확히 /:id 단독에서만 2회·통과 요청 한정(거부는 단락으로 1회)·보안 영향 0(AND 합성, 역전 불가) | PR1 — 요청-로컬 플래그 멱등화. **`use("/:id")` 삭제는 기각 박제**(비명시 hono `/*` 빈-서픽스 매칭 의존 — 업그레이드 리스크) |
| A#4 | ADJUSTED 하 | V1: "드로어 404"가 아니라 **무음 미오픈**(목록에 없으면 fetch 자체 미발생) 정정 + 실 DB CRM 롤 6명 전원 full_name 보유 = 도달 0. profiles 행 부재는 401 원천 차단 | PR1 — spec S-6 각주(조건부 fail-open + 대안 병기: 스코프 키는 advisorId라 id 배정 유지·이름만 대체표기하면 fail-open과 정합 동시 충족 — 표시 어휘는 제품 판단) |
| A#6 | CONFIRMED 하 | V1 실변이 5회: 게이트 제거 시 POST·DELETE·원본 2종 **무증상 실증**(스코프 404가 대신 받음)·PATCH만 RED — 그마저 admin 미존재 테스트의 문구 단언 하나 | PR1 — admin+미존재 고객 404 "고객" 문구 미러를 나머지 4라우트 확산. staff 본인 원본 첨부 201 양성은 비이행(스토리지 mock 하네스 비용 > 실익 — PATCH/POST/DELETE 양성이 동일 게이트 경로 커버) |
| B#3 | CONFIRMED 하 | V2: QuotePreviewModals quoteWritable 미수령·삭제 버튼 무조건 렌더·readonly 진입 2경로 실재("유일 잔존 쓰기 진입점" 전수 확인). 서버 403 fail-closed라 피해 = UX 모순 | PR2 — quoteWritable prop 1개 + 조건 렌더 |
| B#4 | ADJUSTED 하 | V2: 사실 전부 성립하되 도달 = staff 자기-해제 세션 잔류 한정(#301이 타 담당 진입 자체 차단)·피해 = 저장 시 서버 403 상한 | **기록만** — 읽기 게이트를 넣으면 정당한 readonly 열람까지 죽는다. 해소는 "읽기 전용 워크벤치 모드"(별도 제품 결정) 선행. **부수 관찰**: 니즈 카드 "견적 보기" → contracting 견적이면 확인 다이얼로그 비렌더 + editorOpen만 true(보이지 않는 누수 — B#1 부류·선재 여부 blame 후 차기 배치) |
| B#6 | CONFIRMED 하 | V2 실변이 2회 green 실증(applyContractStageNudge 팝오버 닫기 제거·DateTextField 언마운트 cleanup 제거) + 외부클릭/Escape 넛지 클리어 커버 0 grep | PR2 — B#1 픽스와 동반 3종(팝오버 닫힘 단언은 arrange 선행 필수 — 단언만 추가하면 여전히 무의미) |
| C#1 | CONFIRMED 하 (K1-c 병합) | 오케스트레이터 실측: 무catch 2곳·prefetch는 catch 대비 | PR1 — `.catch(() => {})` 2곳 |
| C#2 | CONFIRMED 하 | #300 spec 본문만 "staff 403" 잔존(테스트·코드 주석은 개정됨) | PR1 — S-7 참조 각주 |
| C#3=A#5 | CONFIRMED 하 | /:id 하위 실측 26(등록 28 − 루트 2). ⚠️ K1 이사로 +2 = 28이 되므로 **정정은 하드 수치 제거** 방향 | PR1 — spec·brief·테스트 주석의 수치 서술 정리 |
| B#5 | CONFIRMED 하 | CSS 주석 `<wbr>` ↔ 실마크업 `<br />`(#299 4차 이터레이션 미동기) | PR2 — 주석 1줄 |

### 기록만 (재제안 금지 아님·트리거 대기)
- role-gate.ts:8 "역할별 세분 정책은 별도 슬라이스" 역사 주석(2026-07-11 표기 있어 참 — 다음 문서 배치 갱신 후보).
- C 신성 규칙 3의 일시 잔재 관찰(병렬 test:server 픽스처 크로스 — 현재 0·탐지 정상).
- A clean ⑨ advisorName만 PATCH 시 advisorId null 강제 × #301 결합 관찰(기존재 규칙 — 이번 배치 결함 아님).

## 기각 박제 (재제안 금지)
- `use("/:id")` 한 줄 삭제(A#3 대안) — 비명시 hono 동작 의존.
- 안 ①(requireRoles 스코프-인지 예외)·안 ③(클라 숨김) — K1 비교표 근거.
- B#4 읽기 게이트(viewPromotedQuote/딥링크에 quoteWritable) — 정당 readonly 열람 차단.
- A#6 staff 본인 원본 첨부 201 양성 테스트 — 스토리지 mock 하네스 비용 > 실익.
- 배치 7~11 기각 박제 계속 유효.

## PR 분할 (순차 — useQuoteList.ts 겹침으로 PR1 머지 후 PR2 분기)
- **PR1(서버+K1 전체)**: K1 라우트 이사(서버 신설 2·폐기 2·소유권 파라미터 + 클라 시그니처 2·콜사이트 2·catch 2) + A#3 멱등화 + A#6 그물 4 + 문서(C#2·C#3·A#4 각주) + 이 plan 박제
- **PR2(클라 넛지/게이트)**: B#1 구조 클리어 + B#6 테스트 3종 + B#3 원본 모달 게이트 + B#5 주석

## 진행 상태
- [x] 기준선 재실측(typecheck 0·lint 0·server 622·unit 989·build)
- [x] 감사 3앵글 + 적대 검증 3명(V1 실변이 5회·V2 실변이 2회·V3 설계 비교) + 오케스트레이터 ground-truth 스팟(C 3건·A#1/A#2 인용·B#5) — 판정 확정
- [ ] PR1 이행
- [ ] PR2 이행
- [ ] 통합 검증·머지

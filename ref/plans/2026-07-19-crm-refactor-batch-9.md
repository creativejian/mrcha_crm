# 0719 리팩토링 배치 9 — 감사 결과 · 실행 계획

Last updated: 2026-07-19 (유슨생 세션 `0719-fable5-refactoring` — 감사·적대 검증 완료, 이행 착수)

**범위**: 배치 8(#273~#277 감사 + 실행 산물 #278~#280) 이후 미감사 구간 = **#281(Topbar 통합검색 실데이터화 `2c704a6`)·#282(인박스 이름 매칭 제안 `04ee963`)·`9cecddf`(eslint ignore `.claude/`)**. 코드 15파일 +334/−32(ref/ 제외).

**방법**: 3앵글 병렬 감사(A #281 · B #282 · C 크로스커팅·신성 규칙·문서 정합) → **전건 적대 검증 3명**(반박 의무) → **오케스트레이터 실코드 스팟 교정**(감사원·검증관 보고 오류가 있어 최종 판정 전건을 오케스트레이터가 grep/sed로 재확인 — 아래 프로세스 노트) → CONFIRMED/ADJUSTED/REFUTED → PR 이행.

## 기준선 실측 (2026-07-19)

- `bun run typecheck` **0** · `bun run lint` **0** · `bun run test:unit` **834 pass/0 fail** · `bun run test:server` **580 pass/0 fail**(실 master·잔재 0) · knip **unused export 7·type 9**(배치 8 baseline 정확 유지 — 배치 9發 드리프트 0).
- **신성 규칙 5종 전수 clean**(C 실측): Safari select(diff에 select 신규 0)·서버→클라 import 경계(서버 diff import 신규 = drizzle `inArray`뿐·normalizeName은 경계 준수 위해 의도적 복제)·Workers fetch(fetch 신규 0)·public write 0(서버 변경 = crm.customers SELECT 확장뿐)·dealer 게이트(라우트 신설 0).
- eslint ignore `9cecddf` clean: `.claude/` 추적 파일 0(worktrees 미추적뿐) — 실코드 오포함 없음.

## 감사 총평

- 후보 **16건 = 중 1 · 하 11 · 기각/불필요 4**. 판정: **CONFIRMED 10(그중 조치 불필요·기록 5) · ADJUSTED 4 · REFUTED 2**. 정합성 실버그(지금 오답) 0 — 유일 [중]은 두 검색 표면 간 정규화 드리프트(A#1).
- **#282 핵심 계약 전수 clean**: matchType 오염 불가(변이 테스트 실존 — consultation-inbox.test.ts + 서버 쌍둥이)·두 인박스 미러 동치(normalizeName **2벌 byte-동일** = `trim+공백압축+toLowerCase`, `!appUserId` 필터 대칭·정렬 대칭·방어 복사 대칭)·link가 `applyAppUserLink` SSOT 경유(#276 CHECK 위반 경로 0·phone 직접 쓰기 0줄)·승격 임베딩+AI 힌트 훅 자동 배선·폴링 게이트(배치 8 B#1) 비우회·비로그인 fail-closed 선행·fixture registry(`이름매칭테스트`) 정합·재제안 금지 3건 미접촉.
- **#281 clean**: 목업 잔재 0(`initialCustomers` 참조 제거 전수)·클릭 이동 mode 보존(`onOpenCustomer`→`openCustomerDetailPanel`→`customerListPath(customerMode,…)` — #254 상속)·recent 소스 실 고객·knip 무드리프트.

## 감사 후보 인벤토리 + 판정 (2026-07-19 확정)

| id | [급] 제목 | 판정 | 요지 |
|---|---|---|---|
| A#1 | [중] 목록↔통합검색 정규화 드리프트 | **CONFIRMED·이행** | 통합검색은 질의·haystack 양측 `normalizeSearchValue`(소문자+`[\s-]` 제거), 목록(CustomerManagementPage:176·183)은 trim+toLowerCase만 → `01095880812`·`010 9588`·`s class` 질의가 통합 ○/목록 ×. 드리프트 자체는 #281 이전부터(구 Topbar가 이미 normalize — #281은 이관)이나 실가동으로 사용자 가시화. 픽스 = 목록에 `normalizeSearchValue` 채택 — 질의⊆haystack이면 동일 문자-클래스 삭제 후에도 포함 보존이라 **순수 additive(기존 매칭 상실 0)**. 배치 8 plan:65 "(C 관찰)"의 번복 아닌 **승격**(당시 목록 단독 관찰·현재 표면 간 불일치) |
| A#2 | [하] 통합검색 필드 집합 ≠ 목록(통합-only: customerId·no·statusGroup / 목록-only: 직군 2필드·aiHintPlainText) | ADJUSTED·**유슨생 판단 대기** | 주석 :11-12는 정합 주장을 phoneSecondary에 한정해 허위 아님 — 집합 차이 침묵만. 주석 1줄 or 현행 |
| A#3 | [하] customers 미로드/실패 시 "검색 결과 없음" 데이터-부재 어휘(Topbar:398-402) | CONFIRMED·**유슨생 판단 대기** | 전역 배너(App:413)+반응형 자기 치유가 완화. 배치 8 fail-loud 관례 정합시키려면 로딩/실패/0건 3분기 소형 픽스 |
| A#4 | [하] `slice(0,6)` 캡 후 "{n}명" 표기 — 총원 오인 | CONFIRMED·**유슨생 판단 대기** | 총계 별도 반환 or "6명+" 어휘. 제품 판단 섞임 |
| A#5 | [하] 삭제 고객이 recent 검색에 잔존 → 거짓 성공 토스트+드로어 미오픈+dangling URL | CONFIRMED·기록만 | 같은 세션 내 admin 삭제+재클릭 조합 희박·새로고침 시 소멸 |
| A#6 | [하] 통합검색 유닛 갭(status/statusGroup/source/no·질의 내부 공백 미커버) | CONFIRMED·**이행(A#1 동반)** | 필드 제거 변이가 전부 통과하던 사각 |
| A#7 | [하] haystack `String(no)` — 실데이터에서 customerId 숫자부와 완전 중복 | CONFIRMED·조치 불필요 | `no = Number(code.replace(/\D/g,""))`(customers.ts:57)라 매칭 기여 0·무해 |
| A#8 | [하] `join(" ")` 구분자가 normalize에 소멸 — 필드 경계 오매칭("준010") | CONFIRMED·조치 불필요 | 구 코드 동일 구조(회귀 아님) + 역이점 실존: "김민준 010" 복합 질의가 인접 필드 연결로 매칭 — per-field 분리 픽스는 이 동작을 없앰(**픽스 비권고 박제**) |
| B-a | [하] 상담 인박스 제안 wrapper(`.app-req-name-suggest`) 전파 차단 부재 — 라벨/여백 클릭이 행 토글 | CONFIRMED(사실)·**유슨생 판단 대기(폴리시)** | 버튼은 stopRowToggle 실존. 반론: 행 전체=토글 어포던스가 기존 동작(매칭 칩 span 동일)·배치 8 B#3 conflict 차단은 "액션 직후 알림" 특수 사정. 픽스는 wrapper onClick 1줄(선택) |
| B-b | [하] 제안 클릭→link **인자 계약 무그물** | **CONFIRMED·이행** | `handleLink(r, id = matchedCustomerId)`+`if (!customerId) return` 구조라 회귀로 인자 누락 시 none 행 **무음 no-op**. 배선은 정확(`m.id`)하나 테스트 0건(AppRequestsPage.test.tsx는 phone 매칭만·픽스처 nameMatches:[]·스모크도 생략 경로). 픽스 = 제안 클릭→link 인자 단언 1건(+변이 RED 실관찰) |
| B-c | [하] 서버 테스트 none 단언이 4파일 공유 픽스처 리터럴 `01011112222` 음성 전제 의존 | ADJUSTED·기록만 | 현 충돌 0 실측(타파일 3곳 전부 비충돌 경로)·잔재 tripwire 1차 방어. 다음 서버 테스트 정비 때 전용 리터럴로 |
| B-d | [하] consultation-inbox.ts:69 총괄 주석 "첫 고객(first-wins)"이 `byNameUnlinked`(전원 수집)에 거짓 | **CONFIRMED·이행** | byAppUser/byPhone(`!has` 가드)에만 참. 서버(:153)는 스코프 한정 서술로 정확 — 비대칭. "불가능 주석은 근거를 판다"(#209) 부류. 스코프 한정 1줄 |
| B-e | [중→기각] "제안이 펼쳐야만 보인다"(발견성) | **REFUTED** | 허위 — 제안 블록은 접힌 그룹 행의 매칭 셀에 **상시 렌더**(:200 게이트는 matchType·canPromote·nameMatches만, expandedUserId 무관). spec §3 "인라인 상시" 준수 |
| B-f | [하] normalizeName 파리티 잠금 부재 | **REFUTED(물리 공유)·판단 대기(파리티 유닛만)** | 실체 = **2벌**(클라 상담 인박스:53 ↔ 서버 견적요청:46, `trim+\s+압축+toLowerCase` byte-동일 — "3벌"·"toLowerCase 없음" 주장은 감사·검증 오류, 오케스트레이터 grep 확정). 물리 공유는 plan 26행 각주("양쪽에 2줄로 각자 둔다" — phone 정규화 쌍 선례) **기결 기각**. 파리티 **테스트** 신설만 열림 — 검증관 2 "선례에 잠금 부재 포함(기각 성향·재론 트리거 = 정규화 규칙 복잡화·유니코드 NFC)" ↔ 검증관 3 "생략 명문 없어 기결 아님". 하려면 phone 쌍(sanitizePhoneDigits/normalizePhoneDigits — 역시 무잠금) 동반이 일관적 |
| B-g | [하] 서버 배치 fetch+nameKey 재분배 주석·동명 교차 테스트 | ADJUSTED·기록만 | "주석 0줄"은 **허위**(:149·:153·:156-157·:160 주석 4곳 실존 — 오케스트레이터 sed 확정). 남는 알맹이 = 동명 요청자 2명 교차 비오염 테스트 미커버뿐인데 nameKey 정확 매칭 구조상 오염 원리적 불가 — 실익 낮음 |
| B-h | [하] 제안 칩 라벨 `{name} {code} 연결`뿐 — 동명이인 판단 재료 부족 | CONFIRMED(사실)·기록만 | spec "수동 확정"은 자동 link 금지의 뜻·실데이터 동명 0쌍. 실사용 동명 등장 시 재론(title/phone 보강은 서버 select 확장 동반) |
| B-i | [하] 제안 버튼 disabled 부재 — 이중 클릭 | **REFUTED** | 허위 — `disabled={actingKey === g.key}`(상담)·`disabled={actingId === r.id}`(견적요청) 실존, 기존 버튼과 완전 대칭. 감사원이 인용한 `linkingId`는 **저장소에 존재하지 않는 식별자** |
| C#1 | [하] #282 plan 완료 마커 부재(`- [x]` 0·`- [ ]` 27) | **CONFIRMED·이행(docs)** | 배치 6 #258 선례(plan 드리프트 일괄 동기화)와 동일 부류. 상단 ✅ 헤더 1줄 |
| C#2 | [하] brief "spec §6 후속 … aria-label 소진"의 §6 귀속 오류 | CONFIRMED(cosmetic)·**이행(brief 갱신 시 정정)** | §6 실물 5항목에 aria-label 없음 — 그건 0717 brief 잔여 ⓑ였고 #280 D#3에서 소진(소진 사실은 참) |

## 실행 — PR 1개 + docs

### PR — 검색 정합·인박스 그물 (A#1+A#6 · B-b · B-d)
- **A#1**: `CustomerManagementPage.tsx` 목록 검색 keyword·searchable에 `normalizeSearchValue`(global-customer-search.ts) 채택. TDD: 하이픈리스 digits 질의 페이지 테스트 RED 실관찰 → GREEN. 기존 phoneSecondary 테스트의 "질의도 포맷 기준" 주석 갱신.
- **A#6**: global-customer-search 유닛에 status/statusGroup/source·질의 내부 공백 케이스 추가(+대표 변이 실관찰 1회).
- **B-b**: AppRequestsPage.test.tsx에 none+nameMatches 픽스처 — 제안 버튼 렌더+클릭 시 `linkRequestToCustomer(요청id, 후보id)` 인자 단언. RED = 변이(`handleLink(r)` 인자 제거) 실관찰.
- **B-d**: consultation-inbox.ts:69 주석 스코프 한정 1줄.
- **[skip ci] 금지**(PR 커밋 전체 — squash 전파 사고 관례).

### docs (main 직접 · [skip ci])
- 이 plan 박제 + #282 plan 완료 헤더(C#1).
- 머지 후 brief 배치 9 완결 박제 + C#2 귀속 한 구절 정정.

## 유슨생 판단 대기 → ✅ 전량 이행 완료 (같은 날 유슨생 승인 "진행하자" — #284 squash `5cd4e01`)
- **A#3** 검색 빈 상태 3분기 = 순수 헬퍼 `globalSearchEmptyState(loaded, error)`(실패/로딩/진짜 0건 — error 분기 선행이 load-bearing: App catch가 loaded=true도 세팅) + Topbar props 2종(`customersLoaded`·`customersError`) 신설.
- **A#4** 캡 카운트 = `filterGlobalCustomerSearch` → `{hits, total}` 반환 + `globalSearchCountLabel`(초과 시 "N명 중 6명").
- **A#2** 필드 집합 차이 의도 주석 박제(통합=식별 중심·목록-only는 전역 노이즈·변경 시 두 표면 동시 판단).
- **B-a** `.app-req-name-suggest` wrapper `onClick={stopRowToggle}`(배치 8 B#3 미러 주석).
- **B-f** 파리티 tripwire 2종 채택(**phone 쌍 동반** — 일관성 논점 채택): ①normalizeName 클라↔서버 **소스 본문 byte-동일** 잠금(양쪽 로컬 함수·서버 모듈 drizzle 체인이라 런타임 import 불가 → 소스 추출 비교, `quote-requests-parity.test.ts` 확장) ②sanitizePhoneDigits↔normalizePhoneDigits 행위 파리티(빈 값 ""↔null 인코딩만 계약상 상이·9픽스처). 물리 공유 기결 미도입은 유지. **변이 실관찰 2종**(서버 toLowerCase 제거/digits||null 제거 → 각 파리티만 정확 실패 → 원복).
- 검증: typecheck 0·lint 0·unit **844**(838+6)·build·knip 7/9 무드리프트. TDD(검색 lib 테스트 선행 RED 12/12 실관찰).

## 기록만 4건 → 유슨생 재판단(같은 날) — 2건 승격 이행·2건 기록 확정
- **✅ A#5 승격 이행(#285 squash `ace5828`)**: recent 삭제 고객 잔존 = 거짓 성공 토스트(fail-loud 위반 부류) + 픽스가 저비용 → `resolveRecentSearchCustomers` 순수 헬퍼(현재 customers에서 **id 재해석** — 스냅샷은 id만 신뢰) + Topbar state `recentSearchClicks`→useMemo 파생. **보너스로 스냅샷 stale 표시(수정 후 옛 값)도 동시 해소.** TDD 유닛 3건 RED 실관찰→GREEN.
- **✅ B-c 승격 이행(#285)**: none 프로브를 파일 전용 `01044553311`로 교체(저장소 grep 0건+실 DB phone/secondary 0행 psql 실측) + 근거 주석. 트리거 대기 비용 > 지금 1줄이라 즉시 소진.
- **기록 확정(유슨생)**: **B-g** 동명 교차 테스트(구조상 오염 불가 증명·실익 낮음 — 트리거 = name 매칭 로직 변경 시) · **B-h** 동명이인 판단 재료(실데이터 0쌍·API shape 확장+제품 판단 — 트리거 = 실 동명 등장).
- 검증: typecheck 0·lint 0·unit **847**(844+3)·**server 580**(실 master 전체 재실행)·build.

## 🚫 기각 박제 (재제안 금지)
- **B-e**(제안 접힘 미가시 주장 — 상시 렌더 실증) · **B-i**(disabled 부재 주장 — 실존·대칭) · **A#7**(String(no) 제거 — 중복이나 무해·제거 실익 0) · **A#8**(join 구분자 픽스 — 복합 질의 매칭 역이점 실존, per-field 분리 비권고) · **B-f 물리 공유**(plan 각주 기결 — 파리티 유닛 논점만 열림). 배치 7·8 기각 박제 계속 유효.

## 프로세스 노트 (다음 배치 참고 — 감사 신뢰도)
- **감사원 보고의 실코드 인용을 그대로 믿지 말 것**: 감사원 A 1차 보고 2건이 **존재한 적 없는 코드**(digits 매칭·하드코딩 navigate — git 역사 `-S` 포함 0건)를 인용했고, 감사원 B는 3개 판에 걸쳐 normalizeName 구현 오기 2회·존재하지 않는 `linkingId`·위치 허구·"주석 0줄" 허위·"펼쳐야만 보임" 허위를 냈다. **적대 검증관도 오류**(검증관 2가 "3벌·toLowerCase 없음" 오판정 — 오케스트레이터 grep으로 교정). 이번 배치 최종 판정은 전건 오케스트레이터 실코드 스팟 확인을 통과한 것만 채택. 관례 유지: 전건 적대 검증 + **판정 채택 전 오케스트레이터 ground-truth 스팟**(특히 감사원 간 상충 시).

# `#461`·`#462` 경량 리뷰 판정 — 착수 보류(2026-08-07)

**상태**: 리뷰만 완료. **수정은 유슨생 지시로 보류**("전부 다 할건데 이건 나중에") — 착수 시
이 문서가 작업 목록이다. 브랜치·코드 변경 0(워킹트리 무손상 확인).

- 대상: `#461`(canonical_name 파생 재계산, `5c1cad9` · +234/−20 · 7파일) ·
  `#462`(파트너 modelName 두 빌더 통일, `611a725` · +48/−5 · 4파일)
- 방법: `/code-review <PR> medium` 2회(10앵글 → 검증 → 스윕). 검증 통과 **#461 15건**(CONFIRMED 9 ·
  PLAUSIBLE 6, REFUTED 2 제외) + **#462 8건**.

---

## 🔴 리뷰가 찾은 가장 중요한 사실 — `#462`의 근거가 실제와 다르다

`#462`의 PR 본문·커밋 메시지·소스 주석이 모두 근거로 삼은 서술:

> 파트너는 mcCode 링크가 없으면 `(brand, modelName)` **폴백 매칭**을 타는데, 그 매처가 prefix 매칭이라
> 맨 모델명("5 Series")은 임의 트림에 오매칭될 수 있다

**파트너 레포 실측(`dolim-solution` `src/routes/quote-core.ts:153-189`) 결과 CRM 도달 경로엔 그 폴백이 없다.**
링크 실패는 폴백 없이 즉시 **400 "미취급 차종"**이고, 소스 주석에 `vehicle_key 휴리스틱 fallback 차단`이라
명시돼 있다(2026-07-17부터 — 즉 `#462` 주석 작성 시점에 이미 사실과 달랐다). 인용된 prefix 매처
(`findImCapitalOfferingByTrimPrefix` 등)는 **CRM이 호출하지 않는 cheapest 엔드포인트** 소속이다.

→ `#462`는 **행위상 사실상 no-op**(파트너는 mcCode로 치환하거나 400). 남는 건 패리티·문서 정확성이다.
→ ⚠️ 이 주석을 믿고 "canonical이 오매칭을 막는 안전장치"라는 없는 근거로 mcCode 없는 경로를 열면
   **그쪽에서는 진짜로** vehicle_key 휴리스틱 `.limit(1)` 임의 매칭이 발동한다(위험 방향이 반대).

## 직접 확인한 2건 (에이전트 주장 → 유슨생 세션에서 코드로 재확인)

1. **백필 `--yes` 종료 누락** — `backfill-canonical-names.ts`: 조회 전용 두 분기(`할 일 없음`·`--yes 아님`)는
   `process.exit(0)`이 있는데 **실제 갱신하는 트랜잭션 뒤에는 없다**. `db/client.ts:13`의
   `postgres(connStr, { prepare: false })`에 `idle_timeout`이 없어 커넥션이 이벤트 루프를 잡는다
   → "✅ N행 갱신 완료"를 찍고도 프로세스가 안 죽는다(운영자에겐 "트랜잭션이 걸린 것"으로 보인다).
2. **빈 본문 PATCH → 500** — `trimUpdateBody = trimBody.partial()`이라 `{}`가 zod를 통과하고 모든
   `if (input.X !== undefined)`가 거짓 → `.set({})`이 그대로 drizzle에 도달
   (`drizzle-orm/utils.js:92` `throw new Error("No values to set")`) → `run()`이 500으로 매핑.
   `updateModel`·`updateOption`에도 같은 형태가 있다(이번 PR이 건드린 건 `updateTrim`뿐).

---

## 착수 시 권장 3단 (보류 시점 판단 — 재개 시 재검토 가능)

### 1차 — 싸고 실익 있는 것 (프로덕션 실질 ~10줄)

| 항목 | 위치 | 비고 |
|---|---|---|
| 백필 `--yes` 종료 | `scripts/backfill-canonical-names.ts` | 위 확인 1 — 한 줄 |
| 빈 patch → 400 | `queries/catalog-admin.ts` `updateTrim` | 위 확인 2 |
| 백필 dead column | 같은 스크립트 SELECT의 `mcCode` | 어디서도 안 읽는다 |
| `moveTrims` 타입 복원 | `catalog-admin.ts:457` `Record<string, unknown>` | 키가 정적인데 타입 포기 — 오타가 canonical 갱신을 **조용히 no-op**으로 만든다(이 PR이 없애려던 그 부류) |
| 워크벤치 최종 tier 누락 | `client/src/lib/solution-quote.ts:280` | 계산기는 `canonical ?? trimName ?? **trim.name**`(name은 notNull)인데 워크벤치는 `… ?? model`(맨 모델명) → 두 이름이 다 NULL인 행에서 두 빌더가 **다시 갈라진다**. `BuildArgs.vehicle`에 `name` 필드 자체가 없어 필드 추가 + 훅 배선(`useQuoteWorkbench.ts:1037` 부근)이 필요 |
| 틀린 주석 정정 | `solution-quote.ts:276` | 위 🔴 — 값어치 높음 |
| 스펙 스테일 | `ref/specs/2026-07-14-crm-solution-quote-integration-design.md:87` | "워크벤치는 모델 라벨을 보낸다" |

### 2차 — 별도 PR (구조)

- **canonical 드리프트 트립와이어**: 판정 로직이 이미 백필 dry-run(`:41-56`)에 있다 → 순수 함수로 뽑아
  db-bound 테스트와 공유(`check:lenders`의 `detectLenderDrift` 선례). **Phase 2 브랜드 편집 착수 전에
  세우는 게 가장 싸다**(`isDomestic`은 canonical 포맷 자체를 바꾸는 파생 입력).
- **패리티 크로스 테스트**: 두 빌더 양방향 잠금이 0건이다. `solution-quote.test.ts:70`의 "계산기
  build-payload 패리티"는 **제목 문자열일 뿐 build-payload를 import하지 않는다**. 레포의 패리티 락
  6종(doc-type·roles 등)은 예외 없이 양쪽을 import해 대조하는데 여기만 부재.
- **훅 배선 테스트**: `useQuoteWorkbench.residue.test.tsx`의 픽스처가 전부 `"520i"`라 **두 줄을
  맞바꾸거나 오타를 내도 payload가 바이트 동일** — 원리적으로 검출 불가.

### 보류(기록만 — 재제기 방지)

- 무잠금 read-then-write 경합(`updateTrim`·`moveTrims`) · 백필 TOCTOU · 새 `throw` 500 경로
  — 전부 **좁은 동시성 창**(소수 관리자 동시 편집). ⚠️ TOCTOU 가드로 제안된
  `.where(and(eq(id), eq(canonicalName, t.from)))`는 **그대로 쓰면 안 된다** — canonical이 nullable이고
  drizzle `eq()`는 null 특수 처리가 없어(`col = NULL`은 항상 false) `from`이 null인 행이 영구 no-op이 된다.
- cross-brand 이동 하이브리드(canonical만 신 브랜드·mc_code는 구 브랜드) — UI 도달 불가·계산 영향 0.
- `updateTrim` 재계산의 SELECT 2회 + `TrimEditPanel`이 항상 전체 폼 전송(저장 1회 = 읽기 3·쓰기 1).
- `moveTrims`의 `moved` 카운트가 미존재·중복 id 포함 · 테스트 rollback 헬퍼 6벌 중복(형제 4파일은
  `inRollback` 헬퍼 사용) · `if (cur)` → `if (!cur) return null` 평탄화.
- **REFUTED 2**: nullable 확장(구 앱 `?? ''`와 의도된 parity·소비자 0건·DB 0행) · ctx spread 정리(줄 증가).

## 🔴 유슨생 결정 필요 1건 — `trim_name` 빈 행 정책

같은 상황을 **백필은 "손대지 않고 보고만" 스킵**하는데, 라이브 경로(`updateTrim` `?? cur.trimName ?? ""` ·
`moveTrims` `?? ""`)는 **트림 토큰이 빠진 canonical로 덮어쓴다.** canonical은 앱 검색 3열 OR의 1급
컬럼이라 그 행의 검색 정확도가 즉시 떨어지고, 백필은 같은 행을 계속 스킵하므로 **자동 복구 경로가 없다.**
현재 해당 행 0건(zod `min(1)`이 API 유입 차단)이라 잠재적이지만 psql 직접 쓰기·앱측 쓰기·차기 벌크
임포트(103행 중 30행의 기원)로 재발 가능하다.

선택지 = ⓐ백필과 같은 스킵 정책 공유 ⓑ `cur.name`(notNull) 폴백 ⓒ 현행 유지 + 정책을 문서에 명시.
덧붙여 "빈 trim_name 영구 스킵" 결정이 **스크립트 주석과 stdout에만 있고 판정 SSOT 문서엔 없다.**

## 보조 사실 (재조사 방지)

- 보낸 `modelName`은 **CRM 어디에도 영속되지 않는다** — `SolutionSnapshot.solutionRaw`는 파트너 *응답*만
  담고, 저장 견적의 modelName/trimName은 별도 경로(`useQuoteWorkbench.ts:1404-1405`). → `crm.quotes`·
  임베딩 청크·AI 힌트 무영향, **백필 소급 불필요**.
- 릴레이(`routes/solution.ts`)에 modelName 기반 로그·캐시키·fingerprint 없음. 양쪽 zod 모두 `min(1)`뿐이라
  긴 한글 canonical 안전. 랭킹 모달(8사 병렬)도 같은 base 공유·금융사별 분기 없음.
- 관례(CLAUDE.md/AGENTS.md) 위반 인용 가능 건 0(bare 라인번호 참조 0 · any 0 · 순수 로직 TDD 충족).

# 딜러 할인 인라인 편집 구현 계획 (슬라이스 B2b)

> spec = `ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md` §7.1
> 선행 = A(#375) · B1(#376) · B2a(#377) 머지 완료

**목표:** 딜러가 MC 마스터 트림 테이블에서 **할인 3열을 직접 입력**해 제안을 저장한다.
확정값(catalog)은 회색 보조표기로 함께 보여준다.

**아키텍처:** `useDealerDiscounts(modelId, enabled)`가 내 제안을 `Map<trimId, proposal>`로 들고,
`TrimMetaCells`가 딜러 모드에서 할인 3셀을 입력칸으로 바꾼다. **평면·그룹 두 테이블이 이 셀
컴포넌트를 공유**하므로 한 번 고치면 양쪽에 반영된다.

## 확정한 UX 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 저장 트리거 | **디바운스 자동 저장(800ms)** + 셀에 상태 표시 | 조직 화면에서 유슨생이 [저장] 버튼을 놓쳤다. 누를 게 없으면 놓칠 수 없다. 제안값이라 실수 저장 위험이 낮다(관리자 채택 전) |
| 저장 단위 | **트림(행) 단위** — 3금액을 함께 PUT | 서버 `PUT /discounts/:trimId`가 3금액을 함께 받는다(부분 갱신 아님) |
| 확정값 표기 | 입력칸 **아래 회색 보조표기**, 내 제안과 같으면 생략 | spec §7.1. 중복 노이즈 제거 |
| 실패 피드백 | 마지막 할인 셀에 상태 1개(`저장 중…`/`저장됨`/`저장 실패`) | 3셀에 각각 띄우면 노이즈. **슬라이스 A 조직 화면에 없던 피드백을 여기서는 반드시 넣는다** |

🟡 **조직 화면(슬라이스 A)은 여전히 [저장] 버튼 방식이라 톤이 다르다.** 조직 화면도 자동 저장으로
맞출지는 유슨생 판단 — 이 PR에서는 범위를 넓히지 않고 불일치 사실만 남긴다.

---

### Task 0: 브랜치

```bash
git switch main && git pull -q && git switch -c 0727-dealer-mode-b2b
```

---

### Task 1: `useDealerDiscounts` 훅

**Files:** Create `client/src/lib/dealer-discounts.ts`

- [ ] **Step 1: 훅 작성** — 로드(`GET /api/dealer/discounts?modelId=`) + 저장(`PUT /api/dealer/discounts/:trimId`)

핵심 계약:
- `byTrim: Map<number, DealerDiscountProposal>` — 트림별 내 제안
- `save(trimId, amounts): Promise<void>` — 성공 시 응답 row로 Map 갱신(재조회 없음), 실패는 **throw**해서 셀이 상태를 바꿀 수 있게 한다
- effect의 setState는 **콜백 안에서**(react-hooks/set-state-in-effect, 기준선 0) + alive 가드

- [ ] **Step 2: 검증 + 커밋** — `bun run typecheck && bun run lint`

---

### Task 2: `TrimMetaCells` 딜러 셀 + 두 테이블 배선

**Files:**
- Modify: `client/src/pages/mc-master/trim-cells.tsx`
- Modify: `client/src/pages/mc-master/TrimTable.tsx`
- Modify: `client/src/pages/mc-master/GroupedTrimTable.tsx`
- Modify: `client/src/pages/MCMasterPage.tsx`

- [ ] **Step 1: `DealerDiscountCells` 신설**(`trim-cells.tsx`) — td 3개를 낸다

- 입력은 `formatThousands`로 천단위 표기, 파싱은 `parseWon`(둘 다 `trim-format.ts` 기존 함수 재사용)
- 값은 **파생 상태(draft)** 로 든다 — `useState` 초기값 + effect 동기화는 목록이 늦게 오면 굳는다(#84·슬라이스 A 선례)
- 타이머는 `useRef`에 담고 언마운트 시 `clearTimeout`만 한다(cleanup에서 setState 금지)

- [ ] **Step 2: `TrimMetaCells`에 딜러 분기** — `onSaveProposal`이 있으면 `DealerDiscountCells`, 없으면 기존 읽기 전용 3셀

- [ ] **Step 3: 두 테이블에 props 통과** — `TrimTable`·`GroupedTrimTable`에 `dealerProposals`·`onSaveProposal` 추가(optional이라 admin 호출부는 무변경)

- [ ] **Step 4: MCMasterPage 배선** — 딜러 모드에서만 훅을 켜고 두 테이블에 전달

- [ ] **Step 5: 검증 + 커밋** — typecheck · lint · test:unit

---

### Task 3: 검증 + PR

- [ ] 4종 + unit·pure·build
- [ ] PR 본문: 저장 트리거 결정 근거 · 조직 화면과의 톤 불일치(🟡) · **실기 확인 요청**
      (딜러 계정으로 BMW 트림 할인 입력 → 리로드 유지 → 관리자 화면의 확정값은 안 바뀜)

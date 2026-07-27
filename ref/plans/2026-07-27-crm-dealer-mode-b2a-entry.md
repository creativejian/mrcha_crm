# 딜러 모드 진입 구현 계획 (슬라이스 B2a)

> 실행은 `superpowers:executing-plans`(인라인). spec = `ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md`
> 선행 = 슬라이스 A(PR #375) · B1(PR #376) 머지 완료

**목표:** 딜러가 **사이드바 "할인 업데이트"로 MC 마스터에 들어가 자기 브랜드만** 보게 한다.
Topbar 조직 라벨도 목업에서 실데이터로 바꾼다. **할인 값 입력은 B2b**(인라인 셀 편집).

**아키텍처:** `GET /api/dealer/me`(B1 신설)를 클라 훅으로 감싸 ①Topbar 라벨 ②MC 마스터 브랜드
스코프에 함께 쓴다. 스코프는 `useMcMasterCatalog`에 `scopeBrandId`를 넣어 **한 곳에서** 처리한다.

**왜 B2를 a/b로 쪼개는가:** spec §7.1이 정한 인라인 셀 편집(위=내 제안·아래=확정값)은
`TrimMetaCells` 공통 셀을 건드려 **평면·그룹 두 테이블에 동시 반영**되는 작업이라 별도 리뷰가 낫다.
B2a만으로도 "딜러로 로그인 → 할인 업데이트 → BMW만 보인다"가 완결돼 유슨생이 눈으로 확인할 수 있다.

---

### Task 0: 브랜치

```bash
git switch main && git pull -q && git switch -c 0727-dealer-mode-b2a
git status --short --branch
```

---

### Task 1: `useDealerMe` 훅 + Topbar 조직 라벨 실데이터화

**Files:**
- Modify: `client/src/lib/dealer-profiles.ts`
- Modify: `client/src/components/Topbar.tsx`
- Modify: `client/src/data/roles.ts` (목업 상수 제거)

- [ ] **Step 1: 훅 추가** (`client/src/lib/dealer-profiles.ts` 끝)

```ts
// 딜러 본인 프로필 — Topbar 조직 라벨과 MC 마스터 브랜드 스코프가 함께 쓴다.
// dealer가 아닌 role은 서버가 자기 것만 조회하므로 자연히 null이 온다(게이트 불필요).
// enabled=false면 요청조차 보내지 않는다 — 딜러가 아닌 계정에서 낭비를 만들지 않는다.
export type DealerMe = {
  dealerUserId: string;
  brandId: number;
  brandName: string | null;
  note: string | null;
} | null;

export function useDealerMe(enabled: boolean): { me: DealerMe; loaded: boolean } {
  const [me, setMe] = useState<DealerMe>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    // 실패도 loaded로 넘긴다 — 화면이 무한 로딩에 걸리지 않게 하고, 브랜드 미지정과 같은
    // 취급(안내 문구)을 받는다. 딜러가 아무것도 못 하는 상태는 관리자 매칭으로만 풀린다.
    getJson<DealerMe>("/api/dealer/me")
      .then((row) => {
        if (alive) {
          setMe(row);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return { me, loaded };
}
```

- [ ] **Step 2: Topbar 라벨 교체** (`client/src/components/Topbar.tsx`)

import 교체 — `roleAccountMeta`를 지우고 훅을 넣는다:

```ts
import { type RoleTab } from "@/data/roles";
import { useDealerMe } from "@/lib/dealer-profiles";
```

`const accountMeta = roleAccountMeta[roleTab];`(168행) 삭제하고, `dealerMode` 정의 **뒤에** 추가:

```ts
  // 딜러 조직 라벨은 실데이터다(구: roles.ts 목업 "BMW 한독/서초"). 브랜드 + 비고(딜러사명)를
  // 관리자가 조직 화면에서 지정한다 — 미지정이면 그 사실을 그대로 보여줘야 딜러가 요청할 수 있다.
  const { me: dealerMe } = useDealerMe(dealerMode);
```

`accountOrgLabel` 정의를 교체:

```ts
  const dealerOrgLabel = dealerMe?.brandName
    ? [dealerMe.brandName, dealerMe.note].filter(Boolean).join(" · ")
    : "브랜드 미지정";
  const accountOrgLabel = dealerMode
    ? dealerOrgLabel
    : roleTab === "최고관리자"
      ? "크리에이티브지안"
      : "인천본사 상담팀";
```

- [ ] **Step 3: 목업 상수 제거** (`client/src/data/roles.ts`)

`roleAccountMeta`와 그 타입을 삭제한다. **소비처가 Topbar 한 곳뿐이었고**(grep 확인) 그 한 곳이
실데이터로 바뀌므로 상수 전체가 죽는다. `name: "권지현"` 필드는 애초에 아무도 읽지 않았다.

- [ ] **Step 4: 검증**

```bash
bun run typecheck && bun run lint && bun run knip
```

기대: 전부 0. ⚠️ knip이 `roleAccountMeta` 잔재를 잡으면 삭제가 덜 된 것이다.

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/dealer-profiles.ts client/src/components/Topbar.tsx client/src/data/roles.ts
git commit -m "feat(crm): 딜러 조직 라벨 실데이터화 — 목업 \"BMW 한독/서초\" 제거"
```

---

### Task 2: 사이드바 "할인 업데이트" 실동작화

**Files:**
- Modify: `client/src/components/Sidebar.tsx`

- [ ] **Step 1: 메뉴 정의에 목적지 추가**

현재 `dealerMenuItems` 4개는 **onClick이 없는 완전 목업**이고 첫 항목만 항상 active로 칠해진다
(`navButtonClass(index === 0)`). 목적지가 있는 항목만 실동작시킨다.

```ts
// 딜러 포털 메뉴. 목적지(view)가 있는 항목만 실동작한다 — 나머지는 아직 화면이 없어
// disabled로 둔다(누를 수 있는데 아무 일도 안 일어나는 버튼이 더 나쁘다).
// "할인 업데이트"가 원 설계상 딜러의 MC 마스터 진입점이다(2026-07-27 유슨생 실기 확인).
const dealerMenuItems: Array<[MenuIconName, string, ViewKey?]> = [
  ["dashboard", "대시보드"],
  ["users", "고객 관리"],
  ["discount", "할인 업데이트", "mc-master"],
  ["inventory", "재고 업로드"],
];
```

- [ ] **Step 2: 렌더 교체**

```tsx
        {roleTab === "딜러"
          ? dealerMenuItems.map(([icon, label, view]) => (
            <button
              aria-label={label}
              className={navButtonClass(view != null && visibleActiveView === view)}
              data-label={label}
              disabled={view == null}
              key={label}
              onClick={view ? () => navigate(view) : undefined}
              title={view == null ? "준비 중입니다" : undefined}
              type="button"
            >
              <MenuIcon name={icon} /><span>{label}</span>
            </button>
          ))
          : (
```

⚠️ `ViewKey` 타입이 Sidebar에 없으면 props 시그니처에서 가져온다(`navigate`의 인자 타입).

- [ ] **Step 3: 검증 + 커밋**

```bash
bun run typecheck && bun run lint
git add client/src/components/Sidebar.tsx
git commit -m "feat(crm): 딜러 사이드바 \"할인 업데이트\" 진입점 실동작화"
```

---

### Task 3: MC 마스터 브랜드 스코프(딜러 = 자기 브랜드만)

**Files:**
- Modify: `client/src/pages/mc-master/useMcMasterCatalog.ts`
- Modify: `client/src/pages/MCMasterPage.tsx`

- [ ] **Step 1: 훅에 `scopeBrandId` 추가** (`useMcMasterCatalog.ts`)

시그니처와 brands 세팅·brandId 파생 3곳을 고친다.

```ts
export function useMcMasterCatalog(
  modelId: string | undefined,
  urlBrandId: number | null,
  // 딜러 모드 브랜드 스코프(null = 제한 없음). brands 필터와 brandId 강제를 **한 곳에서** 한다.
  scopeBrandId: number | null = null,
) {
  const [brands, setBrands] = useState<CatalogBrand[]>(() => {
    const cached = getCachedBrands() ?? [];
    return scopeBrandId != null ? cached.filter((b) => b.id === scopeBrandId) : cached;
  });
```

`brandId` 파생 맨 앞에 스코프 분기를 넣는다:

```ts
  const brandId = useMemo(() => {
    // 딜러 모드는 URL·마지막 선택을 무시하고 자기 브랜드로 고정한다 — 손으로 고친 ?brand=가
    // brands 도착 전(길이 0) 검증을 통과하는 창을 아예 없앤다.
    if (scopeBrandId != null) return scopeBrandId;
    const pick =
      urlBrandId ?? (modelId ? getBrandIdForModel(Number(modelId)) : undefined) ?? mcMasterViewState.brandId;
    if (pick != null && (brands.length === 0 || brands.some((b) => b.id === pick))) return pick;
    return brands[0]?.id ?? null;
  }, [urlBrandId, modelId, brands, scopeBrandId]);
```

brands fetch effect도 필터한다:

```ts
  useEffect(() => {
    fetchBrandsCached()
      .then((b) => {
        setBrands(scopeBrandId != null ? b.filter((x) => x.id === scopeBrandId) : b);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  }, [scopeBrandId]);
```

- [ ] **Step 2: MCMasterPage에서 스코프 주입 + modelId 교정** (`MCMasterPage.tsx`)

```ts
  const dealerMode = roleTab === "딜러";
  const { me: dealerMe, loaded: dealerMeLoaded } = useDealerMe(dealerMode);
  // 딜러 모드에서 프로필이 도착하기 전에는 스코프를 알 수 없다 — 그 사이 전 브랜드가 스치는 것을
  // 막으려고 -1(존재하지 않는 브랜드)을 넣어 빈 목록을 만든다. 도착 후 실제 브랜드로 좁혀진다.
  const scopeBrandId = dealerMode ? (dealerMe?.brandId ?? -1) : null;
  const { brands, ... } = useMcMasterCatalog(modelId, urlBrandId, scopeBrandId);
```

⚠️ **modelId는 brandId와 독립 경로다** — `/mc-master/:modelId`로 타 브랜드 모델을 열면 brandId는
자기 브랜드인데 트림은 그 모델 것이 로드된다. models가 도착한 뒤 교정한다:

```ts
  // 딜러 모드: URL의 modelId가 내 브랜드 모델이 아니면 첫 모델로 교정한다(brandId 스코프만으로는
  // 막히지 않는 경로 — 손으로 고친 URL·구 북마크).
  useEffect(() => {
    if (!dealerMode || !modelId || models.length === 0) return;
    if (!models.some((m) => String(m.id) === modelId)) {
      navigate(`/mc-master/${models[0]!.id}`, { replace: true });
    }
  }, [dealerMode, modelId, models, navigate]);
```

브랜드 미지정 딜러에게는 안내를 낸다(빈 사이드바만 보이면 고장으로 읽힌다):

```tsx
  {dealerMode && dealerMeLoaded && dealerMe == null && (
    <div className="card"><div className="panel-body">
      담당 브랜드가 지정되지 않았습니다. 관리자에게 브랜드 지정을 요청해 주세요.
    </div></div>
  )}
```

- [ ] **Step 3: 검증**

```bash
bun run typecheck && bun run lint && bun run test:unit
```

- [ ] **Step 4: 커밋**

```bash
git add client/src/pages/mc-master/useMcMasterCatalog.ts client/src/pages/MCMasterPage.tsx
git commit -m "feat(crm): MC 마스터 딜러 모드 — 자기 브랜드만 (URL 우회 교정 포함)"
```

---

### Task 4: 검증 + PR

- [ ] **Step 1: 4종 + 테스트 + 빌드**

```bash
bun run typecheck && bun run lint && bun run knip && bun run format:check
bun run test:unit && bun run test:pure && bun run build
```

- [ ] **Step 2: PR 생성** — 본문에 반드시 포함

- 딜러 브랜드 차단은 **클라 스코프**다. catalog 읽기 API는 그대로 열려 있고, 그 데이터(기본가·
  MC코드·색상)는 **차선생 앱에서 고객에게 공개되는 정보**라 서버 강제는 과잉으로 판단했다.
  기밀 차단이 아니라 정보 위생·UX 목적임을 명시한다.
- `roleAccountMeta` 목업 제거(소비처 1곳이 실데이터로 대체)
- 딜러 메뉴 3개(대시보드·고객 관리·재고 업로드)는 **화면이 없어 disabled**로 뒀다 — 🟡 제품 결정
  이므로 이사님/유슨생 판단에 따라 숨김/신설로 바뀔 수 있다
- **할인 값 입력은 아직 안 된다**(B2b)

---

## 슬라이스 B2b (다음 계획)

1. `TrimMetaCells` 딜러 모드 분기 — 할인 3셀을 **위=내 제안 입력 / 아래=확정값 회색 보조표기**로
   (평면·그룹 두 테이블이 이 컴포넌트를 공유하므로 한 번에 반영된다)
2. 제안 로드 `GET /api/dealer/discounts?modelId=` + 저장 `PUT /api/dealer/discounts/:trimId`
3. **저장 실패 피드백** — 슬라이스 A 조직 화면에도 없는 문제라 공통 처리
4. 저장 단위 결정(행 단위 저장 버튼 vs blur 즉시 저장) — 조직 화면 결정과 톤을 맞춘다

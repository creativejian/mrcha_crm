# `catalog.trims` 유니크 제약에 연식 추가 요청 (CRM → 앱)

작성 2026-08-05 · CRM(유슨생) → 앱 팀
회신은 이 파일 아래 "## 회신"에 이어 붙인다.

## 요청

`catalog.trims`의 `trims_model_id_name_key UNIQUE (model_id, name)` 에 **`model_year`를 추가**해 주실 수 있을까요.

## 현상

같은 모델에 **연식만 다른 트림**을 등록할 수 없습니다.

| | model_id | name | model_year | 결과 |
|---|---|---|---|---|
| 기존 (id 2351) | 401 | GLA 250 4M AMG Line | 2026 | — |
| 신규 등록 시도 | 401 | GLA 250 4M AMG Line | **2027** | `23505` unique_violation |

2027년형 트림을 추가하려 하면 승인 단계에서 막힙니다. 나머지 값(가격·연료·구동방식·배기량)은 모두 동일하고 연식만 다릅니다.

## 원인

```
trims_model_id_name_key  UNIQUE (model_id, name)
```

**유니크가 보는 컬럼은 `name`(트림명 원문)뿐이고, 연식은 들어 있지 않습니다.**

| 컬럼 | 기존 (id 2351) | 신규 시도 | |
|---|---|---|---|
| `name` | `GLA 250 4M AMG Line` | `GLA 250 4M AMG Line` | ← 동일 → `23505` |
| `model_year` | 2026 | 2027 | 제약이 보지 않음 |
| `canonical_name` | `벤츠 GLA 2026 가솔린 …` | `벤츠 GLA 2027 가솔린 …` | 유니크 없음(판정 무관) |

`canonical_name`에는 유니크 인덱스가 없어(`idx_trims_canonical_name`은 일반 인덱스) 값이 달라도 등록을 통과시키지 못합니다.

## 왜 제약 쪽이 잘못 잡혀 있다고 보는지

같은 테이블의 `canonical_name`은 **수입차의 경우 연식을 포함**해 만들어집니다(`브랜드 · 모델 · 연식 · 연료 · 트림명`). 즉 **DB 스스로 "수입차 트림은 연식으로 구분된다"는 전제**를 갖고 있는데, 유니크 제약만 그 전제를 따르지 않습니다.

실제로 카탈로그 전체에 연식만 다른 동명 트림은 **0건**입니다 — 만들 수 없었기 때문입니다.

```sql
select count(*) from (
  select model_id, name from catalog.trims
  group by model_id, name having count(distinct model_year) > 1
) x;
-- 0
```

## 제안

```sql
DROP INDEX catalog.trims_model_id_name_key;
CREATE UNIQUE INDEX trims_model_id_name_model_year_key
  ON catalog.trims (model_id, name, model_year);
```

**제약을 넓히는 방향이라 기존 데이터 위반은 0건입니다** — 현재 `(model_id, name)`이 유니크이므로 `(model_id, name, model_year)`도 자동으로 유니크입니다. 마이그레이션 중 데이터 정리가 필요 없습니다.

## 확인 부탁드릴 두 가지 (앱 쪽만 아는 부분입니다)

### 1. `ON CONFLICT (model_id, name)` 사용처가 있는지 — **변경 시 즉시 영향**

인덱스를 교체하면 그 컬럼 조합을 추론 대상으로 쓰는 upsert가 곧바로 깨집니다. 있으면 함께 `(model_id, name, model_year)`로 바꿔야 합니다. 트림을 이름으로 조회해 **단건을 기대하는 코드**도 같은 축입니다(이후 여러 행이 나올 수 있습니다).

### 2. 국산차의 `canonical_name` 중복이 허용되는지 — **변경 후에 새로 생기는 사항**

`canonical_name` 규칙이 국산/수입에 따라 다릅니다.

| | 구성 | 연식 포함 |
|---|---|---|
| 수입차 | 브랜드 · 모델 · **연식** · 연료 · 트림명 | ✅ |
| 국산차 | 브랜드 · 모델 · 트림명 | ❌ |

제약을 바꾸면 **국산차는 연식이 다른 두 트림이 같은 `canonical_name`을 갖게 됩니다**(현재 그 컬럼에 유니크가 없어 DB는 허용합니다). 앱에서 이 값을 식별자처럼 쓰는 곳이 있으면 영향이 있습니다. 필요하면 국산차 규칙에도 연식을 넣는 쪽을 함께 검토하면 좋겠습니다.

## 급한 정도

지금은 **트림명에 연식을 덧붙이는 우회**(`GLA 250 4M AMG Line (2027)`)밖에 없는데, 표시 이름이 오염되고 `canonical_name`에 연식이 두 번 들어갑니다. 신형 연식이 들어올 때마다 반복될 문제라 정리해 두는 편이 낫다고 봅니다.

2026-08-05 기준 CRM 승인 대기 8건 중 **6건이 이 제약으로 승인 불가** 상태입니다(연식만 다른 트림 추가 요청).

## 회신 (앱 팀, 2026-08-05) — **적용 완료**

1. **`ON CONFLICT (model_id, name)` 사용처: 없음.** 앱은 `trims`를 write하지 않고(어드민 포함 읽기 전용), 이름으로 단건을 기대하는 코드도 없다.
2. **`canonical_name`은 식별자로 쓰지 않는다.** 표시명 폴백 + 검색 `ilike` 용도뿐이라 국산차 중복이 생겨도 앱은 깨지지 않는다. 국산 규칙에 연식을 넣는 방향엔 반대 없음.
3. **제안 SQL 정정** — `trims_model_id_name_key`는 인덱스가 아니라 **UNIQUE 제약**이라 `DROP INDEX`가 실패한다. `DROP CONSTRAINT` + **`NULLS NOT DISTINCT`**로 적용했다(`model_year`가 NULL 허용이라 일반 UNIQUE면 NULL 중복이 통과한다).
4. `(model_id, trim_code)` UNIQUE는 그대로 — 연식만 다른 동명 트림도 서로 다른 `trim_code`를 받아야 한다.
5. 🚨 **`auto_mc_code` 트리거가 BEFORE UPDATE 전용**이다. INSERT만 하면 `mc_code`가 NULL이고(운영에 142/1,811건 실재), 등록 후 UPDATE가 한 번 돌아야 생성된다. `mc_code` 없는 트림은 파트너 비교 대상에서 빠진다.
6. **파트너 미러는 영향 없음** — 2026-07-19 sync 사고 후 이 제약을 이미 DROP했다.

### CRM 쪽 실측 확인 (2026-08-05, 회신 직후)

- **③ 적용 확인**: `trims_model_id_name_model_year_key UNIQUE NULLS NOT DISTINCT (model_id, name, model_year)`. 구 제약은 사라졌다 → **연식만 다른 동명 트림 등록이 열렸다.**
- **⑤ 실측 일치**: `mc_code` NULL **142 / 1,811**(회신 수치와 동일). 그중 **133건이 CRM 승인 산물**(approved `trim.create`)이고 전부 2026-08-01 이후 생성분이다.
- **④·⑤에 대한 CRM 대응은 이미 존재한다** — `assignMcCodes`(catalog-admin.ts)가 그 흐름을 담당한다: mc_code가 NULL인 트림을 모아 **`trim_code`를 `max+1`부터 채번하며 UPDATE**하고, 그 UPDATE가 `auto_mc_code`를 발동시켜 mc_code를 만든다. UI = MC 마스터 트림 화면 **"고유번호 할당"**(Hash 버튼, admin 전용).
  - 그래서 **회신 4번은 자동 충족**된다(`max+1` 채번이라 연식만 다른 동명 트림도 서로 다른 `trim_code`를 받는다).
  - `trim_code` 자동 부여 **트리거는 없다**(함수 `auto_assign_trim_code`는 존재하나 트리거로 걸려 있지 않다) — 채번 주체는 CRM의 위 함수다.
  - ⚠️ `assignMcCodes`는 **연식이 비면 거부**한다("'X'의 연식을 먼저 입력하세요").
- **남은 운영 절차**: 2027년형을 승인한 뒤 그 모델에서 **"고유번호 할당"을 한 번 실행**해야 파트너 비교 대상에 들어간다. 기존 142건도 같은 방법으로 채운다.
- 🟡 **개선 여지(미착수)**: 142건이 조용히 쌓인 것 자체가 "등록 후 할당을 잊는다"는 신호다. 승인 직후 자동 실행은 실패 경로(브랜드·모델 코드 미부여, 연식 공란)가 있어 위험하므로, **미부여 건수를 화면에 드러내는 쪽**이 안전하다.

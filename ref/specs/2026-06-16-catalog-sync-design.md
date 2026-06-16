# catalog 거울 동기화 (sync 코어, 1단계) 설계

작성일: 2026-06-16
상태: 승인됨 (구현 계획 대기 — writing-plans는 compact 후 진행)

## 배경 / 목적

catalog 차량 거울은 2026-06-14 dump로 1회 import됐다(7테이블, ~29k행). master(미스터차 앱 Supabase)가 변하면 거울을 다시 맞추는 **주기적 동기화**가 필요하다. 이 작업은 그 **sync 코어 로직**(CLI `bun run sync`)을 만든다. 관리 화면 동기화 버튼/서버 API는 2단계(compact 후).

- `vehicle-mirror-db.md`에 sync 규칙이 이미 설계됨: 화이트리스트 fetch → upsert(`deleted_at=NULL` 부활) + 응답에 없는 row soft-delete, conflict target(대부분 `id`, `trim_no_options`만 `trim_id`), 10K+ 테이블 Range 페이징 + total 검증, "사람이 버튼으로 ~2주 full sync".

## 결정사항 (확정)

- **full sync (전체 비교)** — 증분 불가. 데이터 검증(2026-06-16):
  - master에 **`deleted_at` 없음 → hard-delete** → 삭제 감지하려면 전체 id 비교 필요
  - **`updated_at`은 `trims`에만** 있음(brands/models/options/relations/colors는 `created_at`만) → 대부분 테이블은 증분 키로 "수정"을 못 잡음
- **1단계 범위**: 코어 스크립트(CLI). UI 버튼은 2단계.
- **catalog write**: `src/db/client.ts`의 drizzle `.onConflictDoUpdate` (service-role `DATABASE_URL`).
- **soft-delete는 total 검증 통과 시에만** — 불완전 fetch로 멀쩡한 차량을 단종 처리하는 사고 방지.

## 범위

**포함**
- `src/sync/sync-diff.ts` — 순수 diff(`idsToSoftDelete`) + 단위테스트(TDD)
- `src/sync/master-client.ts` — master REST 화이트리스트 fetch + Range 페이징 + total
- `src/sync/sync.ts` — 테이블별 오케스트레이션(fetch → 검증 → upsert → soft-delete) + 요약 출력
- `package.json`에 `sync` 스크립트

**비범위 (다음 단계)**
- 관리 화면 동기화 버튼 + 서버 API + 진행 표시 (2단계)
- 증분 최적화(`trims` `updated_at` 활용) — full로 충분, YAGNI
- 자동 스케줄링(cron) — 수동 트리거 우선

## 아키텍처

순수 로직(diff)은 IO에서 분리해 TDD. master fetch와 catalog write는 얇은 IO 레이어. 오케스트레이션이 테이블 메타를 따라 순서대로 처리. catalog **데이터만** 변경(upsert/soft-delete) — 스키마 불변이라 `db:push` 위험과 무관.

## ① 순수 diff — `src/sync/sync-diff.ts`

```ts
// catalog의 활성(deleted_at IS NULL) id 중 master 응답에 없는 id = soft-delete 대상.
export function idsToSoftDelete<K>(masterIds: ReadonlySet<K>, catalogActiveIds: K[]): K[] {
  return catalogActiveIds.filter((id) => !masterIds.has(id));
}
```

`K`는 `number`(대부분) 또는 `trim_no_options`의 `trim_id`(number). 순수·결정적 → 단위테스트.

## ② master fetch — `src/sync/master-client.ts`

- env `MRCHA_MASTER_SUPABASE_URL` + `MRCHA_MASTER_PUBLISHABLE_KEY`.
- 테이블별 **화이트리스트 컬럼**으로 `?select=col1,col2,…` (`select=*` 금지).
- **Range 페이징**: `Range: {start}-{end}` 헤더 + `Prefer: count=exact` → 응답 `Content-Range: a-b/total`에서 **total** 파싱. total까지 페이지 루프(예: 1,000행 단위).
- 반환 `{ rows, total }`.

## ③ 테이블 메타 + 동기화 흐름 — `src/sync/sync.ts`

테이블 메타(FK 순서): `brands → models → trims → trim_options → colors → trim_no_options → trim_option_relations`. 각 `{ name, conflictTarget, columns }`:
- conflict target: 대부분 `id`, **`trim_no_options`만 `trim_id`**.
- columns(화이트리스트) = `catalog.ts`의 해당 테이블 컬럼 − `deleted_at`(거울 전용). (정확한 컬럼은 구현 계획에서 catalog.ts 기준 확정.)

테이블별:
1. `fetchMasterTable` → `{ rows, total }`
2. **검증**: `rows.length === total` (불완전 fetch 방지)
3. **upsert**: drizzle `.insert(catalogTable).values(rows).onConflictDoUpdate({ target, set: { …allCols, deletedAt: null } })` — master에 있으면 `deleted_at=NULL`로 부활
4. **soft-delete**: `idsToSoftDelete(new Set(masterIds), catalogActiveIds)` → `UPDATE … SET deleted_at=NOW() WHERE {conflictTarget} IN (…) AND deleted_at IS NULL`. **2의 검증 통과 시에만.**

## ④ 안전 / 에러

- **트리거/함수 검증 완료**(2026-06-16 실데이터): catalog 사용자 정의 트리거 **0**(FK 무결성 시스템 트리거 `RI_ConstraintTrigger_*`만 남음 — 제거 금지), 코드생성/`updated_at` 함수 **0**. → sync upsert가 `mc_code`·`updated_at` 등을 재생성/덮어쓰지 않고 **master 값 그대로 보존(순수 거울)**. master 트리거가 거울에서 작동할 일 없음.
- catalog **데이터만** 변경(스키마 불변).
- 테이블 total 불일치/페이징 실패 → 그 테이블 **soft-delete 스킵 + 경고 로그**(upsert는 진행). 불완전 데이터로 잘못 단종 처리 방지.
- 권한: master read=`publishable key`(차량 테이블 read 확인됨), catalog write=`DATABASE_URL`(service-role).
- FK: upsert는 부모(brands/models/trims) 먼저. soft-delete는 `deleted_at` 마킹이라 실제 삭제 아님 → FK 무관.

## ⑤ 실행 / 테스트

- `bun run sync` → 테이블별 `upsert N / soft-delete M / 검증 OK|SKIP` 요약 출력.
- `sync-diff.test.ts`(TDD): `idsToSoftDelete` — master에 없는 catalog id만, 빈 집합, 전부 유지 등.
- master fetch/catalog write는 실DB 통합이라 **첫 실행을 수동 검증**(import 직후라 master==catalog면 soft-delete 0, upsert는 전건 무변경이어야 정상).

## 영향 파일

- 신규: `src/sync/sync-diff.ts`(+`sync-diff.test.ts`), `src/sync/master-client.ts`, `src/sync/sync.ts`
- 수정: `package.json`(`sync` 스크립트)

## 검증

- `bun run typecheck`, `bun run lint` 0
- `bun test`(서버, sync-diff) 또는 `bunx vitest`(위치에 따라)
- `bun run sync` 수동 1회 — import 직후라 soft-delete 0건 + 에러 없음 확인

## 다음 단계 (compact 후)

1. writing-plans로 구현 계획 작성 → 구현
2. 2단계: 관리 화면 동기화 버튼 + 서버 API(`POST /api/catalog/sync`) + 진행/결과 표시
3. (선택) `trims` `updated_at` 증분 최적화, 자동 스케줄

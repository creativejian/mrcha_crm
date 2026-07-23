# CLAUDE.md

이 문서는 **Claude Code 사용자**를 위한 저장소 작업 지침이다.
Codex 사용자는 `AGENTS.md`를 따른다. 이 문서는 그 내용을 그대로 따르며 Claude Code 관점만 보강한다.

## 먼저 읽을 것 (단일 소스)

작업 규칙·세션 연속성·검증 예산·현재 UI 포커스는 아래 문서를 기준으로 한다. Codex와 동일한 소스를 공유한다.

- @AGENTS.md — 작업 규칙, 세션 연속성, 핸드오프, 검증 예산, 현재 UI 포커스
- 세션 복구는 @ref/active-session-brief.md 를 먼저 읽는다(이 파일만 자동 로드된다).
- 부족하면 그때 읽는다 — 장기 상태 `ref/current-working-state.md` / 과거 세션 경위 `ref/session-archive.md` / 설계 근거 `ref/specs/*`·`ref/plans/*`.
  ⚠️ 이 셋에는 `@`를 붙이지 않는다. `@`는 **매 세션 자동 로드**를 뜻해서, 붙이는 순간 "부족하면 읽는다"가
  "항상 읽는다"가 된다(2026-07-21 실측: brief 142k자 + working-state 33k자로 세션 시작 컨텍스트의 20%를 점유).
- 23개 원본 기획 문서를 기본으로 전부 읽지 않는다. 전략/로드맵/아키텍처/견적 엔진 등 명시적으로 필요할 때만 읽는다.

## 팀 구성 (도구 분담)

| 멤버 | 도구 | 비고 |
|------|------|------|
| 이사님 | Codex | `AGENTS.md` 기준, 어시스턴트 호칭 "영실" |
| 송실장 | Claude Code | |
| 유슨생 | Claude Code | |

## 호칭

- 현재 대화 상대(사용자)를 본인 호칭(**송실장** 또는 **유슨생**)으로 부른다. 누구인지 불명확하면 한 번 확인한다.
- `AGENTS.md`의 "이사님 / 영실" 호칭은 Codex 세션 기준이다. Claude Code에서는 위 팀 구성을 따른다.

## 협업 규칙 (AGENTS.md 준용)

- 사용자가 판단을 묻거나(`~같은데`, `어때`, `괜찮을까`, `너 생각은?`) 하면, 의견·트레이드오프·추천을 먼저 제시하고 `적용할까요?`로 확인한다.
- 사용자가 `해줘`, `수정해`, `적용해`, `진행하자`, `응` 이라고 하면 실행 권한으로 본다.

## 메모리 주의

- 각자의 로컬 메모리(`~/.claude/.../memory/`)는 PC 로컬이라 팀과 공유되지 않는다.
- 팀이 공유해야 하는 결정·맥락은 반드시 `AGENTS.md` 또는 `ref/*.md`(git 커밋되는 파일)에 적는다.

## 검증·변경 관례 (Claude Code)

- 변경 후 검증: DOM/TS 변경은 `bun run typecheck`, 모든 변경은 `bun run lint`를 **0 problems**로 유지한다. 큰 변경은 `bun run build`, `bun run test:unit`까지 돌린다. **export를 추가/제거했으면 `bun run knip`**도 함께 돌린다(아래 CI 항목 참조).
- **CI(2026-07-22 도입, `.github/workflows/ci.yml`)**: PR과 main push마다 **7단계**가 자동으로 돈다 — `typecheck` · `lint` · **`knip`** · **`format:check`** · `test:unit` · `build` · **`test:edge`**(Deno). 로컬 검증을 건너뛰라는 뜻은 아니다(CI는 마지막 그물이지 1차 방어선이 아니다).
  - 잡 이름도 7단계를 그대로 적는다(`typecheck · lint · knip · format · unit · build · edge`, 2026-07-23 정정). **step을 추가·제거하면 이름도 함께 고칠 것** — `gh pr checks` 출력엔 이 문자열만 보여서, 실제보다 적게 적으면 그 검증을 로컬에서 건너뛰게 된다(#333에서 구 이름 `typecheck · lint · unit · build`가 knip을 가려 실제로 발생).
  - **knip·format:check는 기준선 0**이다 — 미사용 export 하나, 포맷 어긋남 하나로 PR이 빨개진다. 정당한 예외는 `knip.json`에 사유와 함께 등록한다.
  - ⚠️ `test:server`는 공유 master DB에 붙어 운영 알림까지 발사하므로 **CI에 넣지 않는다** — 로컬 전용이다.
- 변경은 가급적 브랜치 → PR → squash 머지 → 브랜치 삭제 흐름으로 올린다. 커밋/푸시는 사용자가 지시할 때 한다.
- **squash 머지 시 `[skip ci]` 전파 주의**: PR 안의 커밋(문서 포함)에 `[skip ci]`가 있으면 squash 머지 커밋 **본문**에 합쳐져, Cloudflare Pages가 main prod 배포를 통째로 스킵한다(상태 `skipped` = 빌드 미시작). squash로 올릴 PR에는 `[skip ci]`를 붙이지 말 것. 이미 스킵됐으면 CF 대시보드 `배포 관리 → Retry deployment`, 또는 `[skip ci]` 없는 새 커밋(빈 커밋도 가능)을 main에 push해 재트리거한다. (2026-06-19 #52에서 발생)
- TypeScript **6.0.3** 사용: `tsconfig`는 `baseUrl` 없이 `paths`만 쓴다. deprecated 타입(`FormEvent` 등) 대신 `SyntheticEvent`를 쓴다.
- 의도적으로 lint 룰을 끌 때는 `eslint-disable-next-line <rule> -- <사유>` 형식으로 사유를 남긴다.
- `db:push` 금지(스크립트도 제거됨) — `DATABASE_URL`이 master라 `db:push`는 schemaFilter 밖 스키마(public 앱 19테이블·catalog 9테이블)를 DROP할 수 있다. 스키마 변경은 `db:generate` → `db:migrate`만, 항상 `schemaFilter:["crm"]`로 crm만. (차량은 master `catalog` 직접 read — 거울/sync 폐기됨, history: `ref/vehicle-mirror-db.md`)

## 코드 관례 (2026-06-15 합의)

- **any 금지**: `typescript-eslint` recommended + `strict: true`로 도구가 강제한다. 불가피하면 `unknown`으로 받고 좁힌다.
- **mock/데이터 상수화**: 계산·재사용에 쓰이는 값(가격·옵션·할인 등)은 인라인 리터럴 대신 named const로 둔다. 공유되면 `client/src/data/`.
- **테스트**: 순수 계산/유틸 로직은 단위테스트 우선(TDD). 거대 페이지 컴포넌트는 수동/스크린샷 검증을 허용한다.
- **데이터 의미 검증**: DB 컬럼/enum/type 값(예: `trim_options.type` basic/tuning)의 의미는 가정하지 말고 구현 전 `psql "$DATABASE_URL"`로 실제 샘플을 확인한다. (basic을 "무료 기본사양"으로 잘못 가정해 옵션 선택이 깨진 사례)

## 응답 언어

- 항상 한국어로 답한다.

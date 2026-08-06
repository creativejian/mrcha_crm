# CRM 버전 표시 · 릴리스 체계 — 🟡 보류 (설계만 정리, 착수 전)

> **상태: 보류**(2026-08-06 유슨생 — "고민 좀 더 하겠다"). 아래는 그때까지 나온 결정·조사 결과다.
> 재개할 때 **처음부터 다시 논의하지 말 것** — 뒤집힌 결정과 그 이유가 여기 다 있다.

사이드바 로고 블록에 버전(major.minor.patch)을 띄우고, **릴리스 시점을 사람이 정하는** 체계.
출발점: 커밋·푸시마다 버전이 오르면 **팀장·직원에게 노이즈**가 된다.

## ⚠️ 방향이 한 번 뒤집혔다 (2026-08-06)

처음엔 "배포는 main push 유지 · 릴리스만 태그"로 정했다가, 유슨생이 요구를 명확히 하며 뒤집혔다 —
**"crm.mrcha.app에 올라간 코드 = 화면에 뜬 버전, 항상. 앞서가는 게 아니라."**
그래서 **배포 트리거 자체를 태그로** 옮긴다. 아래 결정표는 뒤집힌 뒤의 것이다.

## 착수 시 재확인할 실측 (2026-08-05~06 기준)

- `package.json`에 **`version` 필드 자체가 없다**(`private: true`)
- **git 태그 0개**, `CHANGELOG.md` 없음 → 백지에서 시작
- 워크플로우는 `ci.yml` 하나, 트리거 = `push:[main]` + `pull_request`
- prod = Workers Builds `mrcha-crm`(custom domain `crm.mrcha.app`), **현재는 main push 자동 배포**
- 빌드 타임에 **실값이 필요한 env 2개**: `VITE_SUPABASE_URL` · `VITE_SUPABASE_PUBLISHABLE_KEY`

## 결정

| 축 | 결정 | 근거 |
|---|---|---|
| 버전 SSOT | **`package.json`**(`1.0.0`부터) | `git describe` 금지 — 빌드 환경에 `.git`이 없을 수 있다 |
| **배포 트리거** | **태그 push**(main push는 배포 안 함) | prod 코드와 화면 버전을 **항상 일치**시킨다 |
| 배포 수단 | **GitHub Actions에서 `wrangler deploy`** | Workers Builds는 **태그 트리거 미지원**(조사 완료). ⚠️ Deploy Hook 우회는 **불가** — 훅은 *브랜치 HEAD*를 빌드해서 태그가 가리키는 커밋이 아닌 게 나간다 = 요구가 그대로 깨진다 |
| 스테이징 | **두지 않는다** | staging worker는 바인딩·시크릿·도메인 복제 + "두 환경 어긋나지 않게 유지"가 상시 업무로 붙는다(3인 팀에 과함). preview URL은 배포마다 바뀌어 **카카오 OAuth 허용목록에 등록 불가** |
| 태그 전 확인 | **로컬**(`bun dev` + magiclink 우회) | 실 master DB를 그대로 보므로 staging보다 실물에 가깝다 |
| 릴리스 단위 | **release-please의 Release PR 머지** → 태그 자동 → 그 태그가 배포 트리거 | 머지 전까지 노이즈 0 |
| patch | **나간 릴리스의 긴급 수정 경로**로 정식 사용 | 태그 배포에선 "고쳐서 다시 내보내기"가 patch뿐이다(구 "fix는 릴리스 안 함" 방침은 이 전환으로 자연히 해소) |
| 릴리스 워크플로우 | **`ci.yml`과 별도 파일** | 권한(write vs read)·트리거·concurrency 축이 다르고, 무엇보다 `gh pr checks`의 **잡 이름이 이 레포의 계약**이라(#333) 검증 아닌 것을 섞으면 그 계약이 흐려진다 |

## 구현 범위

1. `package.json`에 `"version": "1.0.0"`
2. 빌드 타임 주입(`vite define` 등) → 사이드바 표시. **실물 2안 만들어 유슨생이 고르게**, collapsed 처리 필수
3. release-please 워크플로우 — **설정은 context7로 최신 확인 후** 작성
4. 태그 배포 워크플로우(`on: push: tags: ['v*']`) — checkout → bun install → build → `wrangler deploy`
   - 첫 스텝에 **`태그 == package.json version` 검증**(어긋나면 배포 중단). 일치가 이 설계의 전부인데 수동 태그 한 번이면 깨진다
   - **`workflow_dispatch`로 임의 태그 재배포** — 태그 배포에선 "이전 태그 다시 배포"가 유일한 롤백이다
   - 검증 8단계 재실행 불필요(그 커밋에서 이미 돌았다)
5. 커밋 `type` 계약을 AGENTS.md에 명문화 — 이제 type이 **버전을 결정**한다

## 🔴 유슨생이 대시보드에서 할 일 (순서 중요)

1. **현재 Workers Builds의 빌드 환경변수 전체 확인** — 위 `VITE_*` 2개 말고 더 있을 수 있다
2. **CF API 토큰 새로 발급**(Workers Scripts:Edit) — 기존 `CF_WORKERS_LOGS_TOKEN`은 read-only라 배포 불가
3. **GitHub Secrets 등록**: `CLOUDFLARE_API_TOKEN` · `CLOUDFLARE_ACCOUNT_ID` · `VITE_*` 실값
   - ⚠️ 메모의 "`CLOUDFLARE_API_TOKEN` 이름 금지"는 **로컬 `.env.local` 한정**이다(wrangler가 그 파일을 스스로 로드해 OAuth를 가린 실사고). GitHub Secrets는 무관하니 그 이름 그대로 써도 된다
4. **마지막에** Workers Builds 자동 배포 끄기 — 먼저 끄면 Actions 준비 전까지 **배포 수단이 없는 공백**이 생긴다

## 함정

- ⚠️ **`VITE_*`를 Secrets에 안 넣으면 prod가 조용히 죽는다** — 빌드는 성공하고(모듈 로드만 통과하면 된다) 배포된 화면이 **로그인부터** 죽는다. CI가 더미값 2개로 돌아 초록으로 보이는 게 함정
- ⚠️ **Workers Builds를 안 끄면 main push 배포가 계속돼** 요구가 그대로 깨진다
- **hotfix가 "머지 → 태그" 두 걸음**이 된다. 머지만 하면 나가던 습관이 남아 있으면, 고친 게 안 나간 상태를 못 알아챈다
- release-please 첫 실행이 기존 커밋 전량을 훑을 수 있다(태그 0개 상태) → 첫 Release PR 내용을 눈으로 확인

## 미결정

- 사이드바 배치 최종안 — 실물 보고 결정
- `major` 승격 기준 — 잠정 "팀에 재교육이 필요한 규모"
- CHANGELOG 섹션 제목 한국어화 여부(release-please 기본은 영문)

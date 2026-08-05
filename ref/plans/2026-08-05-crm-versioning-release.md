# CRM 버전 표시 · 릴리스 체계 (2026-08-05 유슨생 결정)

사이드바 로고 블록에 버전(major.minor.patch)을 띄우고, **릴리스 시점을 사람이 정하는** 체계를 만든다.
요구의 출발점: 커밋·푸시마다 버전이 오르면 **팀장·직원에게 노이즈**가 된다.

## 착수 시 재확인할 실측 (2026-08-05 기준 — 변할 수 있다)

- `package.json`에 **`version` 필드 자체가 없다**(`private: true`라 없어도 되는 상태)
- **git 태그 0개**, `CHANGELOG.md` 없음 → 백지에서 시작
- 워크플로우는 `ci.yml` 하나, 트리거 = `push: [main]` + `pull_request`
- prod = Workers Builds `mrcha-crm`, **main push 자동 배포**, build watch paths 제외 `ref/*`·`*.md`

## 결정 (유슨생 승인)

| 축 | 결정 | 근거 |
|---|---|---|
| 버전 SSOT | **`package.json`** (`1.0.0`부터) | `git describe` 금지 — CF가 **자기 환경에서 빌드**하고 shallow clone이면 태그가 없다. package.json은 확실히 있다 |
| 배포 트리거 | **main push 유지**(바꾸지 않는다) | 태그로 옮기면 ①hotfix가 태그를 기다린다 ②**검증 순서가 역전**된다(태그 전엔 prod에서 못 보는데, 태그는 "확인됐다"는 뜻이어야 한다) ③CF 대시보드 설정 변경 필요 |
| 릴리스 단위 | **release-please의 Release PR 머지** | 머지 전까지 version bump·CHANGELOG가 그 PR 안에만 쌓여 **노이즈 0**. 머지하면 태그·GitHub Release 자동 |
| patch | 도구 자동 판정(`fix:`→patch) 수용 | "버그 fix를 매번 릴리스하지 않는다"는 **Release PR을 안 머지하면 자동 충족** — 여러 건이 다음 릴리스에 함께 실린다 |
| 화면 | 태그라인("이것은 CRM인가 혁명인가")은 **유지**, 버전은 별도 배치 | 애착 문구를 버전으로 대체하지 않는다 |
| 버전↔코드 괴리 | **hover(`title`)에 커밋 SHA** | 배포가 상시라 화면 버전(마지막 릴리스)보다 prod 코드가 앞선다. 팀장·직원 눈엔 `v1.1.0`만, 디버깅 때만 실체 확인 |

⚠️ **화면 버전 = "팀에 알린 단위"**이지 "지금 배포된 코드"가 아니다. 이건 버그가 아니라 설계다.

## 구현 범위

1. `package.json`에 `"version": "1.0.0"` 신설
2. 빌드 타임 주입 — `vite define` 또는 `import.meta.env`. **서버 번들에도 필요한지 먼저 판단**(화면 표시만이면 클라만)
3. 사이드바 표시 — **실물 2안 만들어 유슨생이 고르게** 한다. collapsed(접힘) 상태 처리 필수
4. release-please 워크플로우 — **설정은 context7로 최신 문서 확인 후** 작성(버전·입력 스키마가 자주 바뀐다)
5. 커밋 `type` 계약을 AGENTS.md에 명문화 — 이제 type이 **버전을 결정**한다(잘못된 type = 잘못된 버전)
6. tripwire(태그 == package.json version)는 **release-please가 보장하면 생략** — 중복 그물은 유지 비용만 는다

## 함정

- **CF 빌드 환경에 `.git`이 없을 수 있다** → 버전 출처를 git에 두지 말 것(위 SSOT 결정의 이유)
- 문서만 바뀐 push는 빌드가 스킵되지만, **버전 문자열 변경은 코드 변경**이라 정상 빌드된다
- **release-please 첫 실행이 기존 커밋 전량을 훑을 수 있다** → 초기 릴리스 경계를 명시(`bootstrap-sha` 등) 후 첫 Release PR 내용을 눈으로 확인할 것
- 커밋 메시지 규율이 **진짜 계약**이 된다 — 지금도 Conventional 접두사를 쓰고 있지만, 그동안은 사람이 읽는 용도였다

## 미결정 (착수 시 정할 것)

- 사이드바 배치 최종안 — 실물 보고 결정
- `major` 승격 기준 — 잠정 "팀에 재교육이 필요한 규모"
- CHANGELOG 섹션 제목 한국어화 여부(release-please 기본은 영문 `Features`/`Bug Fixes`)

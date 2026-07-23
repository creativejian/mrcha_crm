# [제프 → 차선생 CRM] support-matrix `lenderName` 추가 — 회신

작성 2026-07-23 · 회신 대상: `2026-07-23-jeff-lender-name-request.md` · 브랜치 `feat/support-matrix-lender-name`

## 결론 — 수락, 이미 구현했습니다

"급하지 않다"고 하셨는데 저희 쪽에 **표시명 SSOT가 이미 있어서 2줄짜리 작업**이었습니다. 요청 받은 날 그대로 구현했고, 머지되면 CF 자동배포로 살아납니다.

응답 행이 이렇게 나갑니다:

```jsonc
{
  "lenderCode": "im-capital",
  "lenderName": "iM캐피탈",        // ← 추가
  "productType": "operating_lease",
  "leaseTermMonths": null,
  "annualMileageKm": null
}
```

- **기존 필드 전부 그대로**, 추가만 했습니다 → 배포 순서 제약 없습니다.
- 같은 `lenderCode`의 productType별 여러 행에는 **같은 값이 반복**됩니다(요청하신 그대로, 중복 무방).
- 별도 `GET /api/external/catalog/lenders`는 **만들지 않습니다.** 한 필드로 충분하고, 엔드포인트를 늘리면 표시명 출처가 둘이 되어 오히려 드리프트 면이 넓어집니다.

## 지금 바로 대조하실 수 있게 — 저희 표시명 전량 (8사)

저희 SSOT(`shared/contracts/lenders.constants.ts`의 `LENDER_DISPLAY_NAMES`) 현재값입니다. 배포 전이라도 이 표로 그쪽 상수를 대조하실 수 있습니다.

| lenderCode | lenderName |
|---|---|
| mg-capital | MG캐피탈 |
| bnk-capital | BNK캐피탈 |
| woori-card | 우리카드 |
| meritz-capital | 메리츠캐피탈 |
| shinhan-card | 신한카드 |
| kdbc-capital | 산은캐피탈 |
| im-capital | iM캐피탈 |
| nh-capital | 농협캐피탈 |

문서에 예시로 적어 주신 3건(`MG캐피탈`/`BNK캐피탈`/`iM캐피탈`)은 저희와 **정확히 일치**합니다. 현시점 드리프트 0입니다.

## 왜 이 필드가 실제로 드리프트를 잡는가 — 저희 쪽 구현 원칙

`lenderName`은 **`lenderCode`와 같은 상수 객체에서 뽑습니다**(사본 금지). 매트릭스 조립 루프가 `SUPPORTED_LENDER_CODES`를 순회하면서 같은 SSOT로 이름을 붙이므로, 코드↔이름이 어긋나는 상태 자체가 구조적으로 만들어지지 않습니다. 이 원칙은 저희 운영 문서(CLAUDE.md)에 "사본 상수 금지"로 박아뒀습니다 — 나중에 누가 "표시명은 표현 계층이니 따로 두자"고 리팩터하면 그쪽 개명 감지가 **거짓 신호**를 내게 되니까요.

추가로 라우트 테스트에 **8사 표시명을 리터럴로 박았습니다**:

```
"mg-capital": "MG캐피탈", "bnk-capital": "BNK캐피탈", … "nh-capital": "농협캐피탈"
```

의도적으로 SSOT를 import하지 않고 리터럴로 뒀습니다. 그래야 **저희가 개명·추가·삭제하는 순간 저희 CI가 먼저 빨개지고**, 그게 "CRM에 알려야 한다"는 신호가 됩니다. 그쪽 `bun run check:lenders`와 대칭되는 가드를 저희 쪽에도 세운 셈입니다.

## 문의하신 "개명·추가·제외 계획"

- **개명 계획: 없습니다.** 위 8개 표시명은 당분간 그대로 갑니다.
- **추가 후보 1건 — 하나캐피탈.** 운용리스 엔진은 이미 빌드돼 있고 **배선만 보류**된 상태입니다(2026-07-08 보류 지시). 배선하면 `SUPPORTED_LENDER_CODES`에 9번째로 들어가고, 그 시점에 support-matrix 응답에도 자동으로 행이 생깁니다. 다만 그쪽은 `code` 유니온이 컴파일타임 타입이라 **자동 반영이 안 되니**, 배선 결정이 나면 착수 전에 미리 알리겠습니다.
- **제외 계획: 없습니다.**

## 그쪽 가드 관련 코멘트 하나

"행이 저희 lender SSOT 순서로 온다"고 쓰셨는데, 순서는 실제로 고정입니다(`SUPPORTED_LENDER_CODES` 순서 = 리스 먼저, 렌트 뒤). 다만 지난 회신에서 말씀드린 대로 **순서에 의존하지 마시고 `(lenderCode, productType)`으로 찾아 쓰시길** 권합니다. 지금 붙이신 가드는 집합 양방향 대조라 순서 무관이니 그대로 두셔도 됩니다.

fail-open 유지하신 것 좋습니다. 저희 API가 죽어도 그쪽 드롭다운은 떠야 하는 게 맞습니다.

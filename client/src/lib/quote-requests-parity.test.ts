// 서버(db/queries/quote-requests)·클라(lib/quote-requests)의 AppQuoteRequestRow 컴파일 타임 파리티.
// 두 타입은 손 선언 이중 정의라 한쪽만 필드를 추가/변경하면 컴파일러가 못 잡고 조용히 드리프트한다
// (서버가 보내도 클라가 안 읽거나, 클라가 기대해도 서버가 안 보냄 → undefined). 컬러 PR #242가
// lockstep 수정으로 위험을 재확인했다(배치5 4-C). type-only import라 런타임 번들에는 유입되지 않는다
// (manage-status-parity.test.ts와 동일 패턴 — 파리티 전용 서버 import 예외).
// + 배치 9 B-f: 이름/전화 정규화 미러 tripwire 2종(아래) — 정규화가 갈라지면 두 인박스(상담=클라 파생·
// 견적요청=서버 파생)가 같은 유저에 다른 후보를 노출한다. 물리 공유는 import 경계상 기결 미도입
// (#282 plan 26행)이라 잠금으로 대신한다. src/lib/customer-phone 런타임 import는 순수 모듈
// (quick-prompt-tools.test.ts 선례 — 테스트 전용·번들 미유입).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import { normalizePhoneDigits } from "../../../src/lib/customer-phone";
import type { AppQuoteRequestRow as ServerRow } from "../../../src/db/queries/quote-requests";

import { sanitizePhoneDigits } from "./customer-create";
import type { AppQuoteRequestRow as ClientRow } from "./quote-requests";

test("서버 ↔ 클라 AppQuoteRequestRow 구조가 양방향으로 할당 가능(필드 드리프트 시 typecheck 실패)", () => {
  const serverToClient: ClientRow = {} as ServerRow;
  const clientToServer: ServerRow = {} as ClientRow;
  void serverToClient;
  void clientToServer;
});

function sourceOf(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

function normalizeNameBodyOf(source: string, file: string): string {
  const matched = source.match(/function normalizeName\(name: string\): string \{\n([\s\S]*?)\n\}/);
  if (!matched) throw new Error(`${file}에서 normalizeName 함수를 찾지 못했다 — 이동/리네임 시 이 파리티도 함께 갱신할 것`);
  return matched[1];
}

// normalizeName은 양쪽 다 로컬 함수(export 없음·서버 모듈은 drizzle 체인이라 런타임 import 불가)
// → 소스 본문 byte-동일을 잠근다. byte-동일 ⇒ 행위 동일. 규칙을 바꿀 땐 양쪽을 함께 고친다.
test("normalizeName 클라(consultation-inbox) ↔ 서버(quote-requests) 본문 byte-동일 — 이름 매칭 미러 tripwire", () => {
  const clientBody = normalizeNameBodyOf(sourceOf("./consultation-inbox.ts"), "client/src/lib/consultation-inbox.ts");
  const serverBody = normalizeNameBodyOf(sourceOf("../../../src/db/queries/quote-requests.ts"), "src/db/queries/quote-requests.ts");
  expect(serverBody).toBe(clientBody);
});

// phone 쌍은 시그니처·빈 값 인코딩이 계약상 다르다(클라 ""/서버 null) — digits 추출 규칙만 파리티.
test("phone digits 정규화 클라(sanitizePhoneDigits) ↔ 서버(normalizePhoneDigits) 규칙 파리티", () => {
  const fixtures = ["010-1234-5678", "010 1234 5678", "01012345678", " 010.1234.5678 ", "+82 10-1234-5678", "abc", "", "  ", "()-"];
  for (const raw of fixtures) {
    expect(sanitizePhoneDigits(raw) || null).toBe(normalizePhoneDigits(raw));
  }
});

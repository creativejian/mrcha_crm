// 서버(db/queries/quote-requests)·클라(lib/quote-requests)의 AppQuoteRequestRow 컴파일 타임 파리티.
// 두 타입은 손 선언 이중 정의라 한쪽만 필드를 추가/변경하면 컴파일러가 못 잡고 조용히 드리프트한다
// (서버가 보내도 클라가 안 읽거나, 클라가 기대해도 서버가 안 보냄 → undefined). 컬러 PR #242가
// lockstep 수정으로 위험을 재확인했다(배치5 4-C). type-only import라 런타임 번들에는 유입되지 않는다
// (manage-status-parity.test.ts와 동일 패턴 — 파리티 전용 서버 import 예외).
import { test } from "vitest";

import type { AppQuoteRequestRow as ServerRow } from "../../../src/db/queries/quote-requests";

import type { AppQuoteRequestRow as ClientRow } from "./quote-requests";

test("서버 ↔ 클라 AppQuoteRequestRow 구조가 양방향으로 할당 가능(필드 드리프트 시 typecheck 실패)", () => {
  const serverToClient: ClientRow = {} as ServerRow;
  const clientToServer: ServerRow = {} as ClientRow;
  void serverToClient;
  void clientToServer;
});

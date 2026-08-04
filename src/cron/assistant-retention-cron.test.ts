import { expect, test } from "bun:test";

import { ASSISTANT_RETENTION_DAYS } from "./assistant-retention-cron";

// 계약값 tripwire — "30일"은 앱 팀 회신(§7)에 명시했고 개인정보 처리방침에 실리는 숫자다.
// 코드에서 조용히 늘리면 우리가 약속한 보존 상한과 실제가 어긋난다(그 어긋남은 증상이 없다).
// 늘리려면 **앱 팀 공유가 선행**이고, 이 테스트가 그 관문이다(파기 동작 자체의 경계 검증은
// 실 DB 쪽 `db/queries/assistant-messages.test.ts` — 여기는 숫자만 잠근다).
// 이 파일은 DB·시크릿을 쓰지 않아 CI(test:pure)에서 돈다 — db-bound registry에 넣지 말 것.
test("업무 AI 대화 보존 기한은 앱 팀과 합의한 30일이다", () => {
  expect(ASSISTANT_RETENTION_DAYS).toBe(30);
});

import { describe, expect, it } from "vitest";

import { resolveInboxViewState } from "./inbox-view-state";

// 인박스 두 페이지(앱 견적요청·상담 신청 DB)가 공유하는 뷰 상태 판정 잠금(배치 8 B#1) —
// 핵심 계약: 데이터를 한 번이라도 성공 수신한 뒤의 폴 실패는 목록을 대체하지 않는다.
describe("resolveInboxViewState — 인박스 뷰 상태 판정", () => {
  it("초기 로드 중(무데이터·무에러)이면 loading", () => {
    expect(resolveInboxViewState({ loading: true, error: false, hasRows: false })).toBe("loading");
  });

  it("무데이터 상태의 실패만 전체 에러 문구", () => {
    expect(resolveInboxViewState({ loading: false, error: true, hasRows: false })).toBe("error");
  });

  it("데이터 보유 중의 폴 실패는 data — 로드된 테이블·카운트를 유지한다", () => {
    expect(resolveInboxViewState({ loading: false, error: true, hasRows: true })).toBe("data");
  });

  it("성공·빈 목록이면 empty", () => {
    expect(resolveInboxViewState({ loading: false, error: false, hasRows: false })).toBe("empty");
  });

  it("성공·데이터 보유면 data", () => {
    expect(resolveInboxViewState({ loading: false, error: false, hasRows: true })).toBe("data");
  });

  it("무데이터 실패는 loading 표기보다 우선한다(기존 렌더 분기 순서 보존)", () => {
    expect(resolveInboxViewState({ loading: true, error: true, hasRows: false })).toBe("error");
  });
});

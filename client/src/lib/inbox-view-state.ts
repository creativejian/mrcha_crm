// 인박스(앱 견적요청 AppRequestsPage · 상담 신청 DB ConsultationRequestsPage) 목록 뷰 상태 판정 —
// 두 페이지 미러 계약의 공유 순수 계층(배치 8 B#1).
// 60초 폴링 1회 실패가 이미 로드된 목록을 통째로 에러 문구로 대체하지 않도록, 전체 에러는
// 무데이터 상태에서만 노출한다. 데이터 보유 중의 폴 실패는 기존 테이블·카운트를 그대로 유지
// (다음 성공 폴이 error를 해제 — 조용한 자기 치유 ≤60s).
export function resolveInboxViewState(args: { loading: boolean; error: boolean; hasRows: boolean }): "error" | "loading" | "empty" | "data" {
  if (args.error && !args.hasRows) return "error";
  if (args.loading) return "loading";
  return args.hasRows ? "data" : "empty";
}

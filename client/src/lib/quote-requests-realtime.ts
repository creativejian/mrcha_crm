import { supabase } from "./supabase";

// public.quote_requests INSERT 실시간 구독. payload(raw row)는 차량명/매칭이 없으므로 쓰지 않고
// onInsert를 "신호"로만 호출 — 호출부가 fetchAppQuoteRequests로 정합 데이터를 다시 읽는다.
// 반환값은 정리 함수(언마운트/로그아웃 시 호출).
// 인증: supabase-js v2가 현재 세션 JWT를 Realtime에 적용한다 → RLS(staff 이상 SELECT) 통과 시 이벤트 수신.
export function subscribeNewQuoteRequests(onInsert: () => void): () => void {
  const channel = supabase
    .channel("crm-app-requests-inbox")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "quote_requests" },
      () => onInsert(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

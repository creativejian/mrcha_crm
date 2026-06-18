import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  // 빌드/런타임에 env 누락을 빨리 드러낸다(로그인 화면 진입 전).
  throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY 가 설정되지 않았습니다.");
}

// detectSessionInUrl 기본 true — OAuth 콜백 복귀 시 토큰 자동 교환.
export const supabase = createClient(url, publishableKey);

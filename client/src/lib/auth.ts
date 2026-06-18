import { supabase } from "./supabase";

// 카카오 OAuth 로그인. 로그인 후 현재 origin으로 복귀(redirect allowlist에 등록 필요).
export async function signInWithKakao(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "kakao",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  // 로그아웃 오류는 무시한다. 서버 세션 무효화가 실패해도 로컬 세션은 이미
  // 정리되어 사용자는 로그인 화면으로 이동되므로 throw하지 않는다.
  await supabase.auth.signOut();
}

// JWT의 top-level user_role claim을 읽는다(Custom Access Token Hook이 주입). 없으면 null.
export async function getRoleClaim(): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  const role = data?.claims?.user_role;
  return typeof role === "string" && role !== "null" ? role : null;
}

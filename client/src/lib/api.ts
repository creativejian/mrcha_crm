import { supabase } from "./supabase";

// 모든 /api 호출에 현재 세션 access_token을 Bearer로 주입한다.
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

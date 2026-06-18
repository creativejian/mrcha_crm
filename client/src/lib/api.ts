import { supabase } from "./supabase";

// 모든 /api 호출에 현재 세션 access_token을 Bearer로 주입한다.
// GET은 5xx(서버/DB 연결의 간헐 실패: CF Workers+pooler 동시 부하)일 때 backoff+jitter로
// 재시도해 일시 실패를 자동 복구한다. 쓰기(POST/PATCH/DELETE)는 중복 위험으로 재시도하지 않는다.
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const maxAttempts = method === "GET" ? 3 : 1;
  for (let attempt = 1; ; attempt++) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(input, { ...init, headers });
    if (res.status < 500 || attempt >= maxAttempts) return res;
    // jitter로 동시 재시도 시점을 분산(첫 로드의 동시 요청이 같은 순간 재충돌하지 않게).
    await new Promise((r) => setTimeout(r, 150 * attempt + Math.random() * 150));
  }
}

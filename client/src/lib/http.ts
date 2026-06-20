import { apiFetch } from "./api";

// 프론트 lib 공용 HTTP 헬퍼. 에러 응답이면 서버 body.error(한글 메시지)를 우선 사용, 없으면 status.
async function httpError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `요청 실패: ${res.status}`);
}

// GET → JSON. 실패 시 throw.
export async function getJson<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  if (!res.ok) throw await httpError(res);
  return (await res.json()) as T;
}

// 쓰기 공통 — body가 있으면 JSON으로 전송, 실패 시 throw.
async function sendRequest(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await apiFetch(url, init);
  if (!res.ok) throw await httpError(res);
  return res;
}

// 응답 본문(생성·수정된 row 등)을 반환하는 쓰기.
export async function sendJson<T>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  return (await sendRequest(url, method, body)).json() as Promise<T>;
}

// 응답 본문을 읽지 않는 쓰기(성공 여부만).
export async function sendVoid(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<void> {
  await sendRequest(url, method, body);
}

import { apiFetch } from "./api";

// 서버 409 link 충돌이 동봉하는 충돌 상대 고객 식별(src/routes/shared.ts run()의 LinkConflictError 매핑과 계약).
export type HttpConflictInfo = { customerCode: string; name: string };

// 서버 에러 응답 — status와 구조화 conflict를 보존해 호출부가 메시지 파싱 없이 분기할 수 있게 한다.
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly conflict?: HttpConflictInfo,
  ) {
    super(message);
  }
}

// 프론트 lib 공용 HTTP 헬퍼. 에러 응답이면 서버 body.error(한글 메시지)를 우선 사용, 없으면 status.
async function httpError(res: Response): Promise<HttpError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; conflict?: HttpConflictInfo };
  return new HttpError(body.error ?? `요청 실패: ${res.status}`, res.status, body.conflict);
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

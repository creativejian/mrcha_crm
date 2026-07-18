import type { Context } from "hono";

import { ConflictError, LinkConflictError } from "../lib/errors";

// drizzle 0.44+는 DB 에러를 DrizzleQueryError("Failed query: …")로 감싸 코드·constraint가 e.cause
// (postgres.js 에러)에만 실린다 — top message만 보면 아래 매핑이 전부 미스(0713 실측: 23505가
// "Failed query: insert into …" 그대로 노출). cause 체인을 걸어 판별 텍스트를 합성한다.
function collectErrorText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur instanceof Error && depth < 5; depth++) {
    parts.push(cur.message);
    const fields = cur as Partial<Record<"code" | "constraint" | "constraint_name" | "detail", unknown>>;
    for (const key of ["code", "constraint", "constraint_name", "detail"] as const) {
      if (typeof fields[key] === "string") parts.push(fields[key]);
    }
    cur = cur.cause;
  }
  return parts.length > 0 ? parts.join(" | ") : String(e);
}

// 트리거/제약 위반 등 DB 에러를 사용자 친화 한글 메시지로.
function dbErrorMessage(e: unknown): string {
  const msg = collectErrorText(e);
  if (/trim_name/i.test(msg) && /(format|hyphen|enforce| - )/i.test(msg))
    return "국산차 트림명은 '서브라인 - 등급' 형식이어야 합니다.";
  if (/foreign key|23503/i.test(msg)) return "참조 중인 데이터가 있어 삭제할 수 없습니다(견적 등).";
  // customers 고유 제약은 constraint 이름으로 먼저 매핑 — 아래 generic 23505는 catalog(트림) 문구라
  // link 경합·채번 경합에서 그대로 노출되면 완전히 오도된다(0713 감사).
  if (/customers_app_user_id_unique/i.test(msg)) return "이 앱 계정은 이미 다른 고객에 연결돼 있습니다.";
  if (/customers_customer_code_unique/i.test(msg)) return "고객 번호 채번이 겹쳤습니다. 잠시 후 다시 시도해 주세요.";
  if (/duplicate key|unique constraint|23505/i.test(msg)) return "같은 모델에 동일한 트림명 또는 고유번호가 있습니다.";
  // phone 배타 CHECK(app_user_id ↔ phone, 마이그 0034) — PATCH 409 게이트 통과 후 동시 link가 끼어든
  // TOCTOU의 최후 방어선. generic 23514 문구로는 사유가 불투명해 constraint 이름 선매칭(위 23505 선례).
  if (/customers_phone_app_exclusive_check/i.test(msg)) return "앱 연결 고객의 번호는 저장할 수 없습니다.";
  if (/check constraint|23514/i.test(msg)) return "허용되지 않는 값입니다.";
  if (/단종|trim_status|enforce_trim_status/i.test(msg)) return "단종 모델의 트림은 단종/블라인드 상태만 가능합니다.";
  if (/prevent_.*_change|code/i.test(msg) && /update|change/i.test(msg)) return "이미 부여된 코드는 변경할 수 없습니다.";
  return msg;
}

// run()의 에러 매핑 단독 사용용 — 성공 응답 형태가 run()과 다른 라우트(201 등)가 catch에서 쓴다.
// instanceof 순서 주의: LinkConflictError는 ConflictError의 서브클래스 — 먼저 검사해야 conflict가 실린다.
export function errorResponse(c: Context, e: unknown): Response {
  if (e instanceof LinkConflictError) return c.json({ error: e.message, conflict: e.conflict }, 409);
  if (e instanceof ConflictError) return c.json({ error: e.message }, 409);
  return c.json({ error: dbErrorMessage(e) }, 500);
}

// 라우트 핸들러 공통: ConflictError → 409, 그 외 에러 → 500(한글 메시지),
// 결과 null + notFoundMsg → 404, 그 외 → 200(json). catalog·customers 라우트가 공유한다.
export async function run<T>(c: Context, work: () => Promise<T>, notFoundMsg?: string): Promise<Response> {
  try {
    const result = await work();
    if (result == null && notFoundMsg) return c.json({ error: notFoundMsg }, 404);
    return c.json(result ?? null);
  } catch (e) {
    return errorResponse(c, e);
  }
}

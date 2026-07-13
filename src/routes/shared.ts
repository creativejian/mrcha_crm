import type { Context } from "hono";

import { ConflictError, LinkConflictError } from "../lib/errors";

// 트리거/제약 위반 등 DB 에러를 사용자 친화 한글 메시지로.
function dbErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/trim_name/i.test(msg) && /(format|hyphen|enforce| - )/i.test(msg))
    return "국산차 트림명은 '서브라인 - 등급' 형식이어야 합니다.";
  if (/foreign key|23503/i.test(msg)) return "참조 중인 데이터가 있어 삭제할 수 없습니다(견적 등).";
  if (/duplicate key|unique constraint|23505/i.test(msg)) return "같은 모델에 동일한 트림명 또는 고유번호가 있습니다.";
  if (/check constraint|23514/i.test(msg)) return "허용되지 않는 값입니다.";
  if (/단종|trim_status|enforce_trim_status/i.test(msg)) return "단종 모델의 트림은 단종/블라인드 상태만 가능합니다.";
  if (/prevent_.*_change|code/i.test(msg) && /update|change/i.test(msg)) return "이미 부여된 코드는 변경할 수 없습니다.";
  return msg;
}

// 라우트 핸들러 공통: ConflictError → 409, 그 외 에러 → 500(한글 메시지),
// 결과 null + notFoundMsg → 404, 그 외 → 200(json). catalog·customers 라우트가 공유한다.
export async function run<T>(c: Context, work: () => Promise<T>, notFoundMsg?: string): Promise<Response> {
  try {
    const result = await work();
    if (result == null && notFoundMsg) return c.json({ error: notFoundMsg }, 404);
    return c.json(result ?? null);
  } catch (e) {
    if (e instanceof LinkConflictError) return c.json({ error: e.message, conflict: e.conflict }, 409);
    if (e instanceof ConflictError) return c.json({ error: e.message }, 409);
    return c.json({ error: dbErrorMessage(e) }, 500);
  }
}

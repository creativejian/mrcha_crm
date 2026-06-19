import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import { VEHICLE_STATUSES } from "../../db/queries/catalog-admin";
import type { DbVariables } from "../../middleware/db";

// catalog 라우트들이 공유하는 Hono 인스턴스 타입. register* 함수가 이 타입을 받아
// 자기 도메인 경로를 등록한다(절대 경로 유지 — sub-app 마운트 안 함).
export type CatalogApp = Hono<{ Variables: DbVariables }>;

// 공통 path/query 스키마. `z.object({ id })` shorthand로 쓰이므로 이름을 유지한다.
export const id = z.coerce.number().int().positive();
export const status = z.enum(VEHICLE_STATUSES);
export const optionType = z.enum(["basic", "tuning"]);

// 트리거/제약 위반 등 DB 에러를 사용자 친화 한글 메시지로.
export function dbErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/trim_name/i.test(msg) && /(format|hyphen|enforce| - )/i.test(msg))
    return "국산차 트림명은 '서브라인 - 등급' 형식이어야 합니다.";
  if (/foreign key|23503/i.test(msg)) return "참조 중인 데이터가 있어 삭제할 수 없습니다(견적 등).";
  if (/duplicate key|unique constraint|23505/i.test(msg)) return "같은 모델에 동일한 트림명 또는 고유번호가 있습니다.";
  if (/단종|trim_status|enforce_trim_status/i.test(msg)) return "단종 모델의 트림은 단종/블라인드 상태만 가능합니다.";
  if (/prevent_.*_change|code/i.test(msg) && /update|change/i.test(msg)) return "이미 부여된 코드는 변경할 수 없습니다.";
  return msg;
}

// 쓰기 핸들러 공통: 에러 → 500(한글), null → 404.
export async function run<T>(c: Context, work: () => Promise<T>, notFoundMsg?: string): Promise<Response> {
  try {
    const result = await work();
    if (result == null && notFoundMsg) return c.json({ error: notFoundMsg }, 404);
    return c.json(result ?? null);
  } catch (e) {
    return c.json({ error: dbErrorMessage(e) }, 500);
  }
}

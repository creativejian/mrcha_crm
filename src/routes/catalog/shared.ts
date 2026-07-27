import { Hono } from "hono";
import { z } from "zod";

import { VEHICLE_STATUSES } from "../../db/queries/catalog-admin";
import type { AuthVariables } from "../../middleware/auth";
import type { DbVariables } from "../../middleware/db";

// 라우트 핸들러 공통 헬퍼(run)는 ../shared에 있고, catalog 라우트에 재노출한다.
export { run } from "../shared";

// catalog 라우트들이 공유하는 Hono 인스턴스 타입. register* 함수가 이 타입을 받아
// 자기 도메인 경로를 등록한다(절대 경로 유지 — sub-app 마운트 안 함).
// AuthVariables는 런타임에 이미 붙어 있다(app.ts의 protect("/api/catalog/*")) — 타입에만
// 없어서 role 게이트와 c.var.user를 쓸 수 없었다(슬라이스 C 채택 라우트가 둘 다 필요).
export type CatalogApp = Hono<{ Variables: AuthVariables & DbVariables }>;

// 공통 path/query 스키마. `z.object({ id })` shorthand로 쓰이므로 이름을 유지한다.
export const id = z.coerce.number().int().positive();
export const status = z.enum(VEHICLE_STATUSES);
export const optionType = z.enum(["basic", "tuning"]);

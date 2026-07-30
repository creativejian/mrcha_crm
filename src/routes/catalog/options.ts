import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import {
  createOption,
  deleteOption,
  listColorsByTrim,
  listOptionRelationsByTrim,
  listOptionsByTrim,
  setTrimNoOption,
  unsetTrimNoOption,
  updateOption,
} from "../../db/queries/catalog-admin";
import { requireRoles } from "../../middleware/role-gate";
import { submitChangeRequest } from "./change-request-kinds";
import { optionCreateBody, optionUpdateBody } from "./schemas";
import { type CatalogApp, id, run } from "./shared";

// /api/catalog/trims/:id/options·colors·no-option, /options/:id — 옵션/색상/무옵션 확정.
//
// ⚠️ 큐 8종은 역할로 결말이 갈린다 — admin 즉시 실행 / manager 202 적재(spec §6.1).
// staff·dealer는 requireRoles가 403. 옵션 삭제는 되돌리기 어려워(참조 손실) admin 전용으로
// 더 좁게 닫는다(spec §3.2).
export function registerOptionRoutes(catalog: CatalogApp) {
  catalog.get("/trims/:id/options", zValidator("param", z.object({ id })), async (c) => {
    const trimId = c.req.valid("param").id;
    const [options, relations] = await Promise.all([
      listOptionsByTrim(trimId, c.var.db),
      listOptionRelationsByTrim(trimId, c.var.db),
    ]);
    return c.json({ options, relations });
  });

  catalog.get("/trims/:id/colors", zValidator("param", z.object({ id })), async (c) =>
    c.json(await listColorsByTrim(c.req.valid("param").id, c.var.db)),
  );

  catalog.post(
    "/trims/:id/options",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id })),
    zValidator("json", optionCreateBody),
    async (c) => {
      // option.create의 큐 payload는 param trimId를 본문과 합친다(승인 replay가 trimId를 payload에서 읽는다).
      const payload = { trimId: c.req.valid("param").id, ...c.req.valid("json") };
      if (c.var.user.role === "manager") return submitChangeRequest(c, "option.create", null, payload);
      return run(c, () => createOption(payload, c.var.db));
    },
  );

  catalog.patch(
    "/options/:id",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id })),
    zValidator("json", optionUpdateBody),
    async (c) => {
      const optionId = c.req.valid("param").id;
      const body = c.req.valid("json");
      if (c.var.user.role === "manager") return submitChangeRequest(c, "option.update", optionId, body);
      return run(c, () => updateOption(optionId, body, c.var.db), "옵션을 찾을 수 없습니다.");
    },
  );

  // 삭제 = 참조 손실 위험(파괴적) — admin 전용(spec §3.2).
  catalog.delete("/options/:id", requireRoles(["admin"]), zValidator("param", z.object({ id })), async (c) =>
    run(c, () => deleteOption(c.req.valid("param").id, c.var.db), "옵션을 찾을 수 없습니다."),
  );

  // 무옵션 확정 토글(옵션 0개일 때만 등록 가능).
  catalog.post(
    "/trims/:id/no-option",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id })),
    async (c) => {
      const trimId = c.req.valid("param").id;
      if (c.var.user.role === "manager") return submitChangeRequest(c, "trim.no-option.set", trimId, {});
      return run(c, () => setTrimNoOption(trimId, c.var.db));
    },
  );
  catalog.delete(
    "/trims/:id/no-option",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id })),
    async (c) => {
      const trimId = c.req.valid("param").id;
      if (c.var.user.role === "manager") return submitChangeRequest(c, "trim.no-option.unset", trimId, {});
      return run(c, () => unsetTrimNoOption(trimId, c.var.db));
    },
  );
}

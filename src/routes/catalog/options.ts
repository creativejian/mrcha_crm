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
import { optionCreateBody, optionUpdateBody } from "./schemas";
import { type CatalogApp, id, run } from "./shared";

// /api/catalog/trims/:id/options·colors·no-option, /options/:id — 옵션/색상/무옵션 확정.
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
    zValidator("param", z.object({ id })),
    zValidator("json", optionCreateBody),
    async (c) => run(c, () => createOption({ trimId: c.req.valid("param").id, ...c.req.valid("json") }, c.var.db)),
  );

  catalog.patch(
    "/options/:id",
    zValidator("param", z.object({ id })),
    zValidator("json", optionUpdateBody),
    async (c) => run(c, () => updateOption(c.req.valid("param").id, c.req.valid("json"), c.var.db), "옵션을 찾을 수 없습니다."),
  );

  catalog.delete("/options/:id", zValidator("param", z.object({ id })), async (c) =>
    run(c, () => deleteOption(c.req.valid("param").id, c.var.db), "옵션을 찾을 수 없습니다."),
  );

  // 무옵션 확정 토글(옵션 0개일 때만 등록 가능).
  catalog.post("/trims/:id/no-option", zValidator("param", z.object({ id })), async (c) =>
    run(c, () => setTrimNoOption(c.req.valid("param").id, c.var.db)),
  );
  catalog.delete("/trims/:id/no-option", zValidator("param", z.object({ id })), async (c) =>
    run(c, () => unsetTrimNoOption(c.req.valid("param").id, c.var.db)),
  );
}

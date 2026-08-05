import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import {
  assignMcCodes,
  countMcCodeGaps,
  createModel,
  deleteModel,
  listModelOptionSummary,
  listModelsByBrand,
  listTrimColorsByModel,
  reorderCatalog,
  updateModel,
} from "../../db/queries/catalog-admin";
import { requireRoles } from "../../middleware/role-gate";
import { submitChangeRequest } from "./change-request-kinds";
import { modelCreateBody, modelUpdateBody } from "./schemas";
import { type CatalogApp, id, run } from "./shared";

// /api/catalog/models* — 모델 CRUD/순서/고유번호 할당.
// (/models/:id/trim-colors·option-summary는 모델 단위 조회라 여기 둔다.)
//
// ⚠️ 큐 8종은 역할로 결말이 갈린다 — admin 즉시 실행 / manager 202 적재(spec §6.1).
// staff·dealer는 requireRoles가 403. 삭제·mc_code·reorder는 되돌리기 어렵거나(삭제)
// 전역 영향(순서·고유번호)이라 admin 전용으로 더 좁게 닫는다(spec §3.2).
export function registerModelRoutes(catalog: CatalogApp) {
  catalog.get("/models", zValidator("query", z.object({ brandId: id })), async (c) => {
    const rows = await listModelsByBrand(c.req.valid("query").brandId, c.var.db);
    return c.json(
      rows.map((m) => ({
        ...m,
        trimCount: Number(m.trimCount),
        minPrice: m.minPrice == null ? null : Number(m.minPrice),
        maxPrice: m.maxPrice == null ? null : Number(m.maxPrice),
      })),
    );
  });

  catalog.post("/models", requireRoles(["admin", "manager"]), zValidator("json", modelCreateBody), async (c) => {
    const body = c.req.valid("json");
    if (c.var.user.role === "manager") return submitChangeRequest(c, "model.create", null, body);
    return run(c, () => createModel(body, c.var.db));
  });

  catalog.patch(
    "/models/:id",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id })),
    zValidator("json", modelUpdateBody),
    async (c) => {
      const modelId = c.req.valid("param").id;
      const body = c.req.valid("json");
      if (c.var.user.role === "manager") return submitChangeRequest(c, "model.update", modelId, body);
      return run(c, () => updateModel(modelId, body, c.var.db), "모델을 찾을 수 없습니다.");
    },
  );

  // 삭제 = 파괴적(복구 경로 없음) — admin 전용(spec §3.2).
  catalog.delete("/models/:id", requireRoles(["admin"]), zValidator("param", z.object({ id })), async (c) =>
    run(c, () => deleteModel(c.req.valid("param").id, c.var.db), "모델을 찾을 수 없습니다."),
  );

  // 고유번호 미부여 집계(2026-08-05) — 브랜드·모델 배지 재료. **부여 권한과 같은 게이트(admin)**로
  // 닫는다: 처리할 수 없는 역할에 "밀린 일" 숫자만 보이면 읽는 사람이 할 수 있는 게 없다.
  // ⚠️ `/models/:id` 류보다 위에 둔다 — 아래 :id 라우트가 "mc-code-gaps"를 id로 먹지 않게.
  catalog.get("/models/mc-code-gaps", requireRoles(["admin"]), async (c) => c.json(await countMcCodeGaps(c.var.db)));

  // mc_code = 고유번호 채번(전역 유일성 영향) — admin 전용(spec §3.2).
  // 모델의 mc_code 미부여 트림에 고유번호 일괄 부여(tx로 원자 처리).
  catalog.post(
    "/models/:id/assign-codes",
    requireRoles(["admin"]),
    zValidator("param", z.object({ id })),
    async (c) => run(c, () => c.var.db.transaction((tx) => assignMcCodes(c.req.valid("param").id, tx))),
  );

  // reorder = 앱 노출 순서 전역 변경 — admin 전용(spec §3.2).
  catalog.post(
    "/models/reorder",
    requireRoles(["admin"]),
    zValidator("json", z.object({ ids: z.array(id).min(1) })),
    async (c) =>
      run(c, async () => {
        await reorderCatalog("models", c.req.valid("json").ids, c.var.db);
        return { ok: true };
      }),
  );

  catalog.get("/models/:id/trim-colors", zValidator("param", z.object({ id })), async (c) =>
    c.json(await listTrimColorsByModel(c.req.valid("param").id, c.var.db)),
  );

  // 트림별 옵션 요약(배지): 기본/튜닝 개수 + 무옵션 확정.
  catalog.get("/models/:id/option-summary", zValidator("param", z.object({ id })), async (c) =>
    c.json(await listModelOptionSummary(c.req.valid("param").id, c.var.db)),
  );
}

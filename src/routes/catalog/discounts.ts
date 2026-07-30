import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { DISCOUNT_FIELDS } from "../../../client/src/lib/discount-adoption";
import { adoptDealerProposal, listModelProposals, undoLatestAdoption } from "../../db/queries/discount-adoptions";
import { requireRoles } from "../../middleware/role-gate";
import { type CatalogApp, id, run } from "./shared";

// 딜러 할인 제안 조회·채택(슬라이스 C) — **admin 전용**.
//
// ⚠️ requireRoles를 명시로 붙이는 이유: 딜러 제안 열람·채택은 admin 전용이다. dealerWriteGate는
// **쓰기만** 보므로 GET을 막지 않아 딜러가 경쟁사 제안을 들여다보는 경로도 열린다.
// (2026-07-30부터 catalog 쓰기 전 라우트에 role 게이트가 붙었다 — 큐 8종 admin·manager,
// 삭제/이동/mc_code/reorder admin 전용. spec: 2026-07-30-crm-catalog-change-approval-design.md §6.2)
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §6.3·§7.2
// field 어휘는 client/src/lib/discount-adoption.ts가 SSOT다 — 여기 리터럴을 다시 적으면
// 스키마·쿼리·클라 팝오버가 어긋날 수 있다(어긋나도 타입은 통과한다).
const adoptBody = z.object({
  field: z.enum(DISCOUNT_FIELDS),
  dealerUserId: z.uuid(),
});

export function registerDiscountRoutes(catalog: CatalogApp) {
  // 모델 단위 조회 — 화면이 트림 표의 셀마다 "제안 있음" 단서를 달아야 하므로 목록 전체가
  // 한 번에 필요하다(트림 단위면 5시리즈 하나에 13번 왕복한다). 딜러 쪽
  // GET /api/dealer/discounts?modelId= 와 같은 축이다.
  catalog.get(
    "/models/:id/discount-proposals",
    requireRoles(["admin"]),
    zValidator("param", z.object({ id })),
    async (c) => run(c, () => listModelProposals(c.req.valid("param").id, c.var.db)),
  );

  // 필드 단위 채택. **트랜잭션을 여기서 연다** — 쿼리 함수는 받은 executor를 그대로 쓰는 레포
  // 관례(updateQuote 선례)라 원자성이 호출자 책임이고, 확정 할인 갱신과 감사가 따로 커밋되면
  // "누가 바꿨는지 모르는 확정 할인"이 남는다(그 공백을 메우려고 만든 표다).
  //
  // 채택자(adopted_by)는 **클라가 보내지 않는다** — 세션의 c.var.user.id를 쓴다. 감사 주체를
  // 요청 본문에서 받으면 위조가 가능하고, 그 순간 감사가 감사가 아니게 된다.
  catalog.post(
    "/trims/:id/discount-adoptions",
    requireRoles(["admin"]),
    zValidator("param", z.object({ id })),
    zValidator("json", adoptBody),
    async (c) => {
      const { field, dealerUserId } = c.req.valid("json");
      const trimId = c.req.valid("param").id;
      const adoptedBy = c.var.user.id;
      return run(
        c,
        () => c.var.db.transaction((tx) => adoptDealerProposal({ trimId, field, dealerUserId, adoptedBy }, tx)),
        // null = 제안 없음 · 그 필드 미제안 · 제안자 자격 상실. 셋 다 "채택할 값이 없다"이고
        // 화면은 어느 쪽이든 목록을 새로 받으면 사실이 드러난다(사유를 나누지 않는다).
        "채택할 제안이 없습니다.",
      );
    },
  );

  // 되돌리기(2026-07-29) — 최신 감사 행의 직전 값을 복원한다(토글 의미론 — 쿼리 주석).
  // 채택과 같은 이유로 admin 전용·트랜잭션·주체는 세션에서 얻는다. 복원 금액을 본문으로 받지
  // 않는 것도 채택과 같은 원칙이다 — 무엇으로 돌아가는지는 감사 사슬이 결정해야 감사가 참이다.
  catalog.post(
    "/trims/:id/discount-adoptions/undo",
    requireRoles(["admin"]),
    zValidator("param", z.object({ id })),
    zValidator("json", z.object({ field: z.enum(DISCOUNT_FIELDS) })),
    async (c) => {
      const trimId = c.req.valid("param").id;
      const { field } = c.req.valid("json");
      const adoptedBy = c.var.user.id;
      return run(
        c,
        () => c.var.db.transaction((tx) => undoLatestAdoption({ trimId, field, adoptedBy }, tx)),
        // null = 이력 없음 · 트림 없음 · 감사-확정 드리프트. 셋 다 "감사가 보증하는 직전 값이
        // 없다"이고, 화면은 목록을 새로 받으면 사실이 드러난다.
        "되돌릴 채택 이력이 없습니다.",
      );
    },
  );
}

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { brandIdOfTrim, listMyTrimDiscounts, upsertDealerTrimDiscount } from "../db/queries/dealer-discounts";
import {
  deleteDealerProfile,
  deleteDealerProposals,
  getDealerProfile,
  isDealerRole,
  listDealerRoster,
  upsertDealerProfile,
} from "../db/queries/dealer-profiles";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";
import { requireRoles } from "../middleware/role-gate";
import { run } from "./shared";

// /api/dealer/* — 딜러 도메인. 두 축이 한 라우터에 산다:
//   admin 축 = 명부(/roster)·브랜드 매칭(/profiles/:userId PUT)·데이터 삭제 2종(DELETE)
//   dealer 본인 축 = /me · /discounts (allowlist가 여는 유일한 딜러 쓰기 = PUT /discounts/:trimId)
// /profiles는 딜러에게 닫혀 있다 — 자기 브랜드를 스스로 바꿀 수 있으면 브랜드 소유권 검증이
// 무의미해진다(아무 브랜드로 갈아타면 그만이다).
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §6.3
export const dealer = new Hono<{ Variables: AuthVariables & DbVariables }>();

const userIdParam = z.object({ userId: z.uuid() });
// note는 딜러사명 한 줄("동성모터스"·"코오롱모터스"·"바바리안")이라 100자로 제한한다.
// 빈 문자열은 라우트에서 null로 정규화 — "미입력"과 같은 뜻을 두 값으로 저장하지 않는다.
const profileBody = z.object({
  brandId: z.number().int().positive(),
  note: z.string().trim().max(100).nullable().optional(),
});

// 딜러 명부(조직 화면의 별도 "딜러" 테이블) — role이 내려간 딜러도 포함하는 합집합이다
// (queries/dealer-profiles.ts listDealerRoster 주석 참조).
dealer.get("/roster", requireRoles(["admin"]), async (c) => c.json(await listDealerRoster(c.var.db)));

// 입력값 삭제 — 그 딜러의 제안 전부. 브랜드 매칭은 남아 다시 입력할 수 있다.
// ⚠️ 채택된 확정 할인과 채택 감사는 건드리지 않는다(spec §5 · 쿼리 함수 주석).
dealer.delete(
  "/profiles/:userId/proposals",
  requireRoles(["admin"]),
  zValidator("param", userIdParam),
  async (c) => run(c, async () => ({ deleted: await deleteDealerProposals(c.req.valid("param").userId, c.var.db) })),
);

// 딜러 해제 — 제안 + 브랜드 매칭. **트랜잭션**으로 묶는다: 제안만 지워지고 매칭이 남으면
// "브랜드는 있는데 입력값이 사라진" 어중간한 상태가 되고, 관리자는 무엇이 지워졌는지 알 수 없다.
dealer.delete(
  "/profiles/:userId",
  requireRoles(["admin"]),
  zValidator("param", userIdParam),
  async (c) => {
    const { userId } = c.req.valid("param");
    return run(c, () => c.var.db.transaction((tx) => deleteDealerProfile(userId, tx)));
  },
);

dealer.put(
  "/profiles/:userId",
  requireRoles(["admin"]),
  zValidator("param", userIdParam),
  zValidator("json", profileBody),
  async (c) => {
    const { userId } = c.req.valid("param");
    // 대상 가드(2026-07-28 유슨생) — 딜러가 아닌(또는 profiles에 없는) 대상에게는 저장 불가.
    // 화면은 "현재 딜러 아님" 행의 편집을 disabled로 막지만 그건 표시일 뿐이고(DevTools),
    // 뚫리면 딜러였던 적 없는 uuid에도 매칭이 생겨 명부에 유령 행이 뜬다. 409 = 호출자 권한
    // 문제(requireRoles 403)가 아니라 **대상 상태**가 거부 사유라는 구분(PATCH phone 선례).
    if (!(await isDealerRole(userId, c.var.db))) {
      return c.json({ error: "딜러가 아닌 구성원에게는 브랜드를 지정할 수 없습니다." }, 409);
    }
    const { brandId, note } = c.req.valid("json");
    const row = await upsertDealerProfile(
      { dealerUserId: userId, brandId, note: note?.length ? note : null },
      c.var.db,
    );
    return c.json(row);
  },
);

// ── 딜러 본인용 (슬라이스 B1) ────────────────────────────────────────────────
const trimIdParam = z.object({ trimId: z.coerce.number().int().positive() });
const modelIdQuery = z.object({ modelId: z.coerce.number().int().positive() });
// 금액은 원 단위 0 이상. null = 그 필드는 미제안(비우기도 저장 대상이다).
const amount = z.number().int().nonnegative().nullable();
const discountBody = z.object({ financialAmount: amount, partnerAmount: amount, cashAmount: amount });

// 본인 프로필 — 게이트 없이 **자기 것만** 돌려준다(role 무관, dealer가 아니면 자연히 null).
// 소비처: 딜러 모드 브랜드 게이트 + Topbar 조직 라벨(B2에서 목업 "BMW 한독/서초"를 대체).
dealer.get("/me", async (c) => c.json(await getDealerProfile(c.var.user.id, c.var.db)));

// 내 제안(모델 단위) — 쿼리가 dealerUserId로 필터하므로 다른 딜러 제안은 섞이지 않는다.
dealer.get("/discounts", zValidator("query", modelIdQuery), async (c) =>
  c.json(await listMyTrimDiscounts(c.var.user.id, c.req.valid("query").modelId, c.var.db)),
);

// 제안 저장 — **allowlist가 여는 유일한 딜러 쓰기 경로**(role-gate.ts 참조).
// 브랜드 소유권을 fail-closed로 검증한다: 프로필 없음(브랜드 미지정) · 트림 없음 · 다른 브랜드
// = 전부 403. cross-schema라 DB가 막아주지 않으므로 이 검사가 유일한 방어선이다.
dealer.put(
  "/discounts/:trimId",
  zValidator("param", trimIdParam),
  zValidator("json", discountBody),
  async (c) => {
    const { trimId } = c.req.valid("param");
    const [profile, trimBrandId] = await Promise.all([
      getDealerProfile(c.var.user.id, c.var.db),
      brandIdOfTrim(trimId, c.var.db),
    ]);
    if (!profile || trimBrandId === null || profile.brandId !== trimBrandId) {
      return c.json({ error: "권한이 없습니다." }, 403);
    }
    const row = await upsertDealerTrimDiscount(
      { trimId, dealerUserId: c.var.user.id, ...c.req.valid("json") },
      c.var.db,
    );
    return c.json(row);
  },
);

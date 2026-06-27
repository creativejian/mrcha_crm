import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { createCustomerFromRequest, linkRequestToCustomer, listQuoteRequests } from "../db/queries/quote-requests";
import type { DbVariables } from "../middleware/db";
import { run } from "./shared";

export const quoteRequests = new Hono<{ Variables: DbVariables }>();

const idParam = z.object({ id: z.uuid() });

quoteRequests.get("/", (c) => run(c, () => listQuoteRequests(c.var.db)));

// 전화 매칭된 기존 고객에 연결(app_user_id set).
quoteRequests.post(
  "/:id/link",
  zValidator("param", idParam),
  zValidator("json", z.object({ customerId: z.uuid() })),
  (c) =>
    run(
      c,
      () => linkRequestToCustomer(c.req.valid("param").id, c.req.valid("json").customerId, c.var.db),
      "요청 또는 고객을 찾을 수 없습니다.",
    ),
);

// 미매칭 요청 → 신규 고객 생성(채번+insert 트랜잭션).
quoteRequests.post("/:id/create-customer", zValidator("param", idParam), (c) =>
  run(c, () => c.var.db.transaction((tx) => createCustomerFromRequest(c.req.valid("param").id, tx)), "요청을 찾을 수 없습니다."),
);

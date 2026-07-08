// 앱 상담신청(public.consultations) → CRM 고객 통합 라우트. 견적요청(quote-requests.ts) 패턴 미러.
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { createCustomerFromConsultation, linkConsultationToCustomer, listConsultations } from "../db/queries/consultations";
import { scheduleEmbedOnWrite } from "../lib/embed-on-write";
import type { DbVariables } from "../middleware/db";
import { run } from "./shared";

export const consultations = new Hono<{ Variables: DbVariables }>();

const idParam = z.object({ id: z.uuid() });

// 인박스: pending 상담신청 목록.
consultations.get("/", (c) => run(c, () => listConsultations(c.var.db)));

// 매칭된 기존 고객에 연결(app_user_id set + 빈 연락처 보강). app_user_id 중복이면 run()이 409로 매핑.
// 견적요청 link와 달리 재임베딩을 스케줄하지 않는다 — 연결이 세팅하는 필드(app_user_id·phone)는
// customer_profile 청크 구성 필드가 아니다(상담신청 문의 자체의 임베딩은 후속 Task 범위).
consultations.post(
  "/:id/link",
  zValidator("param", idParam),
  zValidator("json", z.object({ customerId: z.uuid() })),
  (c) =>
    run(
      c,
      () => linkConsultationToCustomer(c.req.valid("param").id, c.req.valid("json").customerId, c.var.db),
      "요청 또는 고객을 찾을 수 없습니다.",
    ),
);

// 미매칭 상담신청 → 신규 고객 생성(채번+insert 트랜잭션).
consultations.post("/:id/create-customer", zValidator("param", idParam), (c) =>
  run(c, async () => {
    // 트랜잭션 커밋 후 스케줄 — 승격 INSERT가 프로필 청크 구성 필드(needModel/source)를 시드하므로
    // customer_profile 재임베딩(고객 PATCH 훅과 동일 불변). 상담신청 문의 임베딩(consultation_request)은 후속 Task 7.
    const row = await c.var.db.transaction((tx) => createCustomerFromConsultation(c.req.valid("param").id, tx));
    if (row) scheduleEmbedOnWrite(c, { sourceType: "customer_profile", sourceId: row.id });
    return row;
  }, "요청을 찾을 수 없습니다."),
);

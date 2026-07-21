// 앱 상담신청(public.consultations) → CRM 고객 통합 라우트. 견적요청(quote-requests.ts) 패턴 미러.
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import {
  createCustomerFromConsultation,
  linkConsultationToCustomer,
  listConsultations,
} from "../db/queries/consultations";
import { scheduleAiHintRefresh } from "../lib/ai-hint-on-write";
import { schedulePromotionEmbeds } from "../lib/promotion-embeds";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";
import { requireRoles } from "../middleware/role-gate";
import { run } from "./shared";

export const consultations = new Hono<{ Variables: AuthVariables & DbVariables }>();

// 인박스 전면 게이트(읽기 포함) — admin·manager 전용(2026-07-21 유슨생 결정·pending 항목 16.
// 근거·위험 서술은 requireRoles 주석과 role scope spec §4). 라우트 선언보다 앞이어야 작동한다.
consultations.use("*", requireRoles(["admin", "manager"]));

const idParam = z.object({ id: z.uuid() });

// 인박스: pending 상담신청 목록.
consultations.get("/", (c) => run(c, () => listConsultations(c.var.db)));

// 매칭된 기존 고객에 연결(app_user_id set — phone은 저장 안 함·기존 phone은 전이 규칙, 2026-07-17 spec).
// 응답에 droppedPhone 동봉(secondary 점유로 못 옮긴 번호 — 클라 토스트). app_user_id 중복이면 run()이 409로 매핑.
// customer_profile은 재임베딩하지 않는다 — 연결이 세팅하는 필드(app_user_id·phone)는 그 청크의 구성
// 필드가 아니다(상담신청 문의 자체도 임베딩/RAG가 아니라 업무 AI customer_consultations 도구가
// crm.consultation_dismissals를 제외하고 직접 조회해 답한다). 다만 **그 유저의 앱 견적요청**은 이 연결이
// 생겨야 비로소 적재 가능해지므로 quote_request 청크를 스케줄한다(견적요청 link와 동일 — 0709 감사에서
// 이 훅 누락이 발견됐다: 상담 경로로 승격된 유저의 견적요청이 백필 전까지 코퍼스에 없었다).
consultations.post(
  "/:id/link",
  zValidator("param", idParam),
  zValidator("json", z.object({ customerId: z.uuid() })),
  (c) =>
    run(
      c,
      async () => {
        const row = await linkConsultationToCustomer(c.req.valid("param").id, c.req.valid("json").customerId, c.var.db);
        if (row) {
          await schedulePromotionEmbeds(c, { appUserId: row.appUserId });
          scheduleAiHintRefresh(c, c.req.valid("json").customerId); // 연결로 앱 상담 문의가 재료에 들어온다
        }
        return row;
      },
      "요청 또는 고객을 찾을 수 없습니다.",
    ),
);

// 미매칭 상담신청 → 신규 고객 생성(채번+insert 트랜잭션).
consultations.post("/:id/create-customer", zValidator("param", idParam), (c) =>
  run(c, async () => {
    // 트랜잭션 커밋 후 스케줄 — 승격 INSERT가 프로필 청크 구성 필드(needModel/source)를 시드하므로
    // customer_profile 재임베딩(고객 PATCH 훅과 동일 불변) + 그 유저의 앱 견적요청 청크(연결 성립).
    const row = await c.var.db.transaction((tx) => createCustomerFromConsultation(c.req.valid("param").id, tx));
    if (row) {
      await schedulePromotionEmbeds(c, { appUserId: row.appUserId, customerId: row.id });
      scheduleAiHintRefresh(c, row.id);
    }
    return row;
  }, "요청을 찾을 수 없습니다."),
);

// (CRM 전용 삭제 DELETE /:id는 배치 12 K1에서 customers 라우터로 이사 — DELETE /api/customers/:id/consultations/:consultId.
//  드로어 소비처가 이 라우터의 인박스 전면 게이트에 걸리던 부수 피해 해소. 이 라우터 = 순수 인박스만.)

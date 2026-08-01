// 탈퇴 인지 큐 스태프 라우트(2026-08-01 spec §4) — 목록 + 탈퇴확인(분류 확정·즉시 실행).
// 권한: admin·manager 전체 / staff는 그 고객의 담당자만 / dealer는 전 라우트 fail-closed.
// 확인 = 인지 + 분류 확정이지 삭제 거부권이 아니다(이사님 결정 2026-08-01 — 취소 경로 없음).
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { customers } from "../db/schema";
import { confirmDeletionJob, getDeletionJob, listReceivedDeletionJobs } from "../db/queries/deletion-jobs";
import { removeObjects, type StorageEnv } from "../lib/storage";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";
import { run } from "./shared";

export const accountDeletions = new Hono<{ Variables: AuthVariables & DbVariables }>();

// 내부 운영 큐 — 딜러(외부 인원)는 읽기 포함 전면 차단.
accountDeletions.use("*", async (c, next) => {
  if (c.var.user.role === "dealer") return c.json({ error: "권한이 없습니다." }, 403);
  await next();
});

accountDeletions.get("/", (c) => run(c, () => listReceivedDeletionJobs(c.var.db)));

const confirmSchema = z.object({
  classification: z.enum(["purge", "active_fulfillment", "settlement_reference"]),
  retentionBasis: z.string().trim().min(1).max(200).optional(),
  // B 필수(아래 수동 검증 — 날짜 유효성까지 zod로 묶으면 메시지가 흩어진다). ISO datetime.
  retentionUntil: z.string().optional(),
  // C 선택 — YYYY-MM-DD. 입력 시 스켈레톤이 pending으로 승격, 생략 시 review_required 유지.
  clawbackUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

accountDeletions.post("/:id/confirm", zValidator("param", z.object({ id: z.uuid() })), async (c) => {
  const parsed = confirmSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "잘못된 요청입니다." }, 400);
  const { classification, retentionBasis, clawbackUntil } = parsed.data;

  let retentionUntil: Date | undefined;
  if (classification === "active_fulfillment") {
    retentionUntil = new Date(parsed.data.retentionUntil ?? "");
    if (Number.isNaN(retentionUntil.getTime()) || retentionUntil.getTime() <= Date.now()) {
      return c.json({ error: "보존 기한(retentionUntil)은 미래 시각이어야 합니다." }, 400);
    }
  }

  const jobId = c.req.valid("param").id;
  const result = await c.var.db.transaction(async (tx) => {
    // 담당자 스코프(고객 role scope와 동일 방향): staff는 그 고객의 담당자만 확정할 수 있다.
    // 잡 → 고객 advisor를 트랜잭션 안에서 읽어 확정과 직렬화한다(확인 직전 담당자 변경 경합 최소화).
    if (c.var.user.role === "staff") {
      const job = await getDeletionJob(jobId, tx);
      if (!job) return { outcome: "not_found" as const };
      if (job.status !== "received" || !job.customerId) return { outcome: "already_executed" as const };
      const [row] = await tx.select({ advisorId: customers.advisorId }).from(customers).where(eq(customers.id, job.customerId));
      if (row?.advisorId !== c.var.user.id) return { outcome: "forbidden" as const };
    }
    return confirmDeletionJob(jobId, { classification, confirmedBy: c.var.user.id, retentionBasis, retentionUntil, clawbackUntil }, tx);
  });

  if (result.outcome === "forbidden") return c.json({ error: "담당 고객만 확정할 수 있습니다." }, 403);
  if (result.outcome === "not_found") return c.json({ error: "탈퇴 요청을 찾을 수 없습니다." }, 404);
  if (result.outcome === "already_executed") return c.json({ error: "이미 처리된 탈퇴 요청입니다." }, 409);

  // Storage 삭제는 커밋 후(고객 삭제 라우트와 동일 관례 — 롤백 시 파일만 증발하는 사고 방지).
  await removeObjects(c.env as StorageEnv, result.storagePaths).catch((err: unknown) => {
    for (const path of result.storagePaths) console.error(`Storage remove 실패(탈퇴 실행) path=${path}:`, err);
  });
  return c.json({ ok: true });
});

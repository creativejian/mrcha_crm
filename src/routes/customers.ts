import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getCustomer, getCustomerAdvisorName, getCustomerAppUserId, listCustomers, updateCustomer, type CustomerWritePatch } from "../db/queries/customers";
import { listQuoteRequestsByUser } from "../db/queries/quote-requests";
import {
  addMemo, updateMemo, deleteMemo,
  addTask, updateTask, deleteTask,
  addSchedule, updateSchedule, deleteSchedule,
} from "../db/queries/customer-children";
import { addDocument, deleteDocument, getDocumentPath, nextSortOrder, reorderDocuments, updateDocument } from "../db/queries/customer-documents";
import { createQuote, deleteQuote, updateQuote, setQuoteFile, clearQuoteFile, getQuoteFilePath } from "../db/queries/customer-quotes";
import { validateLookupValue, validateStatusSelection } from "../lib/lookup-validate";
import { isAllowedMime, MAX_DOC_BYTES, safeFileName } from "../lib/document-validation";
import { cleanupEmbeddingOnDelete, scheduleEmbedOnWrite } from "../lib/embed-on-write";
import { createSignedUrl, removeObject, uploadObject, type StorageEnv } from "../lib/storage";
import { sendAssignmentPush } from "../lib/push-notify";
import type { AuthVariables } from "../middleware/auth";
import { holdWork, type DbVariables } from "../middleware/db";
import { run } from "./shared";

export const customers = new Hono<{ Variables: AuthVariables & DbVariables }>();

// 쓰기 가능 컬럼(전부 optional·문자열 nullable). 값 enum 검증 없음(추후 사이클).
export const customerWriteSchema = z.object({
  phone: z.string().nullable().optional(),
  residence: z.string().nullable().optional(),
  customerType: z.enum(["개인", "개인사업자", "법인사업자"]).nullable().optional(),
  customerTypeDetail: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  statusGroup: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  chance: z.string().nullable().optional(),
  advisorName: z.string().nullable().optional(),
  advisorId: z.uuid().nullable().optional(), // 담당자 profiles.id — 역할 scope(staff=본인 담당)의 매칭 키
  team: z.string().nullable().optional(),
  needModel: z.string().nullable().optional(),
  needTrim: z.string().nullable().optional(),
  needColors: z.string().nullable().optional(),
  needMethod: z.string().nullable().optional(),
  needTiming: z.string().nullable().optional(),
  needMemo: z.string().nullable().optional(),
  needContractTerm: z.string().nullable().optional(),
  needInitialCost: z.string().nullable().optional(),
  needAnnualMileage: z.string().nullable().optional(),
  needDeliveryMethod: z.string().nullable().optional(),
  needContractFocus: z.string().nullable().optional(),
  needCustomerNote: z.string().nullable().optional(),
  needReviewNote: z.string().nullable().optional(),
});

// customer_profile 임베딩 청크를 구성하는 쓰기 가능 필드(buildCustomerProfileChunkText와 정렬).
// needCompare는 청크에 포함되지만 아직 쓰기 스키마에 없어 제외(쓰기 경로가 생기면 추가).
const CUSTOMER_PROFILE_EMBED_KEYS = [
  "residence", "customerType", "customerTypeDetail", "source", "advisorName",
  "needModel", "needTrim", "needMethod", "needTiming", "needColors",
  "needContractTerm", "needInitialCost", "needAnnualMileage", "needDeliveryMethod", "needContractFocus",
] as const satisfies readonly (keyof z.infer<typeof customerWriteSchema>)[];

customers.get("/", async (c) => c.json(await listCustomers(c.var.db)));

customers.get("/:id", zValidator("param", z.object({ id: z.uuid() })), (c) =>
  run(c, () => getCustomer(c.req.valid("param").id, c.var.db), "고객을 찾을 수 없습니다."));

// 고객 상세 니즈 영역: 그 고객(app_user_id)의 앱 견적요청 목록. 수기 고객(app_user 없음)은 빈 배열.
customers.get("/:id/quote-requests", zValidator("param", z.object({ id: z.uuid() })), (c) =>
  run(
    c,
    async () => {
      const found = await getCustomerAppUserId(c.req.valid("param").id, c.var.db);
      if (!found) return null; // 고객 없음 → 404
      return found.appUserId ? listQuoteRequestsByUser(found.appUserId, c.var.db) : [];
    },
    "고객을 찾을 수 없습니다.",
  ),
);

customers.patch(
  "/:id",
  zValidator("param", z.object({ id: z.uuid() })),
  zValidator("json", customerWriteSchema),
  async (c) => {
    const patch = c.req.valid("json");
    // 진행상태(1차/2차) 키가 올 때만 lookup 종속 검증. 그 외엔 추가 왕복 0.
    if (patch.statusGroup !== undefined || patch.status !== undefined) {
      const error = validateStatusSelection({ statusGroup: patch.statusGroup, status: patch.status });
      if (error) return c.json({ error }, 400);
    }
    // 계약 가능성(chance) 닫힌 집합 검증. chance 키가 올 때만 1쿼리.
    if (patch.chance !== undefined) {
      const error = validateLookupValue("chance", patch.chance);
      if (error) return c.json({ error }, 400);
    }
    // 유입 경로(source) 닫힌 집합 검증.
    if (patch.source !== undefined) {
      const error = validateLookupValue("source", patch.source);
      if (error) return c.json({ error }, 400);
    }
    // 담당자 배정(advisorName): 배정시각은 서버가 기록(클라 시각 신뢰 안 함).
    // 담당자가 실제로 바뀔 때만 스탬프 — 동일 담당자 재저장(팀만 변경 등)에 assigned_at을 리셋하면
    // 목록 '배정 후 N분' SLA가 왜곡된다. 해제(null)면 배정시각도 함께 비운다(미배정+배정시각 모순 방지).
    let finalPatch: CustomerWritePatch = patch;
    // 배정 알림 대상(저장 성공 후 발송). null이면 알림 없음. 저장 로직과 무관 — 알림에만 쓰인다.
    let assignPush: { userId: string; body: string } | null = null;
    if (patch.advisorName !== undefined) {
      if (patch.advisorName === null) {
        finalPatch = { ...patch, assignedAt: null };
      } else {
        const current = await getCustomerAdvisorName(c.req.valid("param").id, c.var.db);
        if (!current) return c.json({ error: "고객을 찾을 수 없습니다." }, 404);
        if (current.advisorName !== patch.advisorName) {
          finalPatch = { ...patch, assignedAt: new Date() };
          // 담당자 실제 변경 → 배정 알림 후보(스펙 §5.2). 발송 조건: advisorId NOT NULL(대상 user_id 확보) +
          // 배정 실행자 ≠ 대상(자기 배정은 저장은 되되 알림 skip). advisorName만 오고 id 없으면 대상 불명 → skip.
          if (patch.advisorId && patch.advisorId !== c.var.user.id) {
            assignPush = { userId: patch.advisorId, body: current.name };
          }
        }
      }
      // 담당자 변경인데 advisorId가 안 오면 id를 비운다 — 이름만 갈리고 구 id가 남는 스테일
      // (타 상담사 scope에 남의 고객이 잡히는 사고) 방지. 해제(null)도 같은 규칙으로 id 동반 해제.
      // 디렉토리 기반 배정 UI(후속 PR)가 항상 advisorId를 동봉하면 이 분기는 방어선으로만 남는다.
      if (patch.advisorId === undefined) finalPatch = { ...finalPatch, advisorId: null };
    }
    return run(c, async () => {
      const row = await updateCustomer(c.req.valid("param").id, finalPatch, c.var.db);
      if (row) {
        const id = c.req.valid("param").id;
        // 니즈 3필드 중 이번 PATCH에 온 키만 재임베딩(스펙 결정 3). 값 비움 포함 —
        // 훅의 fresh read가 빈 텍스트로 판정해 임베딩 행을 삭제한다(경로 통일).
        if (patch.needMemo !== undefined) scheduleEmbedOnWrite(c, { sourceType: "need_memo", sourceId: id });
        if (patch.needCustomerNote !== undefined) scheduleEmbedOnWrite(c, { sourceType: "need_customer_note", sourceId: id });
        if (patch.needReviewNote !== undefined) scheduleEmbedOnWrite(c, { sourceType: "need_review_note", sourceId: id });
        // 프로필 청크(고객당 1행) 구성 필드가 이번 PATCH에 있으면 재임베딩 — 필드 목록은 빌더
        // (buildCustomerProfileChunkText)와 정렬. 값이 실제로 안 바뀐 no-op PATCH는 content_hash skip이 흡수.
        if (CUSTOMER_PROFILE_EMBED_KEYS.some((k) => patch[k] !== undefined)) {
          scheduleEmbedOnWrite(c, { sourceType: "customer_profile", sourceId: id });
        }
        // 배정 알림(저장 성공 후, 응답 비차단). self·advisorId 부재는 위 분기에서 이미 걸러짐.
        // holdWork가 실패를 흡수하고 sendAssignmentPush 자체도 throw 안 하지만, 이중으로 안전.
        if (assignPush) {
          holdWork(c, sendAssignmentPush(c, {
            userId: assignPush.userId,
            title: "담당 고객으로 배정되었습니다",
            body: assignPush.body,
          }));
        }
      }
      return row;
    }, "고객을 찾을 수 없습니다.");
  },
);

// ── 자식 컬렉션 CRUD (메모/할일/일정) ──────────────────────────────
const idParam = z.object({ id: z.uuid() });
const childParam = z.object({ id: z.uuid(), childId: z.uuid() });
const memoBody = z.object({ body: z.string().nullable().optional() });
const taskBody = z.object({ category: z.string().nullable().optional(), due: z.string().nullable().optional(), body: z.string().nullable().optional(), done: z.boolean().optional() });
const scheduleBody = z.object({ scheduledDate: z.string().nullable().optional(), scheduledTime: z.string().nullable().optional(), type: z.string().nullable().optional(), memo: z.string().nullable().optional(), done: z.boolean().optional() });
const quoteScenarioBody = z.object({
  scenarioNo: z.number().int().nullable().optional(),
  isSaved: z.boolean().optional(),
  purchaseMethod: z.enum(["장기렌트", "운용리스", "금융리스", "중고리스", "할부", "일시불"]).nullable().optional(),
  termMonths: z.number().int().nullable().optional(),
  monthlyPayment: z.string().nullable().optional(),
  lender: z.string().nullable().optional(),
  depositMode: z.string().nullable().optional(),
  depositValue: z.string().nullable().optional(),
  downPaymentMode: z.string().nullable().optional(),
  downPaymentValue: z.string().nullable().optional(),
  residualMode: z.string().nullable().optional(),
  residualValue: z.string().nullable().optional(),
  mileageMode: z.string().nullable().optional(),
  mileageValue: z.string().nullable().optional(),
  // 앱카드 4섹션(2026-07-04): 계산엔진 연결 전 수기 입력 결과 필드 + 자동차세/보조금
  carTaxIncluded: z.boolean().nullable().optional(),
  subsidyApplicable: z.boolean().nullable().optional(),
  subsidyAmount: z.string().nullable().optional(),
  totalReturnCost: z.string().nullable().optional(),
  totalTakeoverCost: z.string().nullable().optional(),
  dueAtDelivery: z.string().nullable().optional(),
  interestRate: z.string().nullable().optional(),
});
const quoteGuidanceSchema = z.object({
  deliveryComment: z.string(),
  stockNotice: z.string(),
  expectedDelivery: z.string(),
  customerRegion: z.string(),
  keyPoints: z.array(z.string()),
  recommendReason: z.string(),
  services: z.array(z.string()),
});
const quoteCreateBody = z.object({
  entryMode: z.enum(["manual", "solution", "original"]).nullable().optional(),
  status: z.string().nullable().optional(),
  quoteRound: z.string().nullable().optional(),
  stockStatus: z.enum(["재고있음", "재고없음", "재고확인중"]).nullable().optional(),
  brandName: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
  trimName: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  sourceQuoteRequestId: z.uuid().nullable().optional(),
  guidance: quoteGuidanceSchema.nullable().optional(),
  // #4c-2 워크벤치 스냅샷(전부 optional, composer는 미전송)
  trimId: z.number().int().nullable().optional(),
  basePrice: z.string().nullable().optional(),
  optionTotal: z.string().nullable().optional(),
  options: z.array(z.object({ id: z.number().int(), name: z.string(), price: z.number().nullable() })).nullable().optional(),
  finalDiscount: z.string().nullable().optional(),
  // 할인 구성 내역(finalDiscount 총액의 내역 — 기본 할인 제외 추가 행만, 2026-07-05 이사님 결정:
  // CRM은 모든 할인 항목 표시·고객 앱 payload는 총액만). amount는 unit이 percent면 %값(소수 허용), 아니면 원.
  discountLines: z.array(z.object({ label: z.string(), amount: z.number(), unit: z.enum(["amount", "percent"]) })).nullable().optional(),
  acquisitionTax: z.string().nullable().optional(),
  acquisitionTaxMode: z.enum(["normal", "hybrid", "electric", "manual"]).nullable().optional(),
  bond: z.string().nullable().optional(),
  delivery: z.string().nullable().optional(),
  incidental: z.string().nullable().optional(),
  finalVehiclePrice: z.string().nullable().optional(),
  acquisitionCost: z.string().nullable().optional(),
  exteriorColorId: z.number().int().nullable().optional(),
  exteriorColorName: z.string().nullable().optional(),
  exteriorColorHex: z.string().nullable().optional(),
  interiorColorId: z.number().int().nullable().optional(),
  interiorColorName: z.string().nullable().optional(),
  interiorColorHex: z.string().nullable().optional(),
  scenario: quoteScenarioBody.optional(),
  scenarios: z.array(quoteScenarioBody).max(3).optional(),
});
const quotePatchBody = z.object({
  status: z.string().nullable().optional(),
  entryMode: z.enum(["manual", "solution", "original"]).nullable().optional(),
  quoteRound: z.string().nullable().optional(),
  stockStatus: z.enum(["재고있음", "재고없음", "재고확인중"]).nullable().optional(),
  brandName: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
  trimName: z.string().nullable().optional(),
  // "viewed" write 미수용(배치 E) — 열람은 앱이 advisor_quotes.viewed_at에 직접 기록(read-through), crm.quotes 어휘에서 축소.
  appStatus: z.enum(["draft", "queued", "sent"]).nullable().optional(),
  decisionStatus: z.enum(["none", "considering", "confirmed", "contracting"]).nullable().optional(),
  note: z.string().nullable().optional(),
  guidance: quoteGuidanceSchema.nullable().optional(),
  primaryScenarioId: z.uuid().nullable().optional(),
  bumpRevision: z.boolean().optional(),
  scenario: quoteScenarioBody.optional(),
  // PR2a: 워크벤치 수정용 스냅샷 + 다중 시나리오 교체
  trimId: z.number().int().nullable().optional(),
  basePrice: z.string().nullable().optional(),
  optionTotal: z.string().nullable().optional(),
  options: z.array(z.object({ id: z.number().int(), name: z.string(), price: z.number().nullable() })).nullable().optional(),
  finalDiscount: z.string().nullable().optional(),
  // 할인 구성 내역 — quoteCreateBody 동형(전체 교체, null=클리어). 주석은 create 쪽 참조.
  discountLines: z.array(z.object({ label: z.string(), amount: z.number(), unit: z.enum(["amount", "percent"]) })).nullable().optional(),
  acquisitionTax: z.string().nullable().optional(),
  acquisitionTaxMode: z.enum(["normal", "hybrid", "electric", "manual"]).nullable().optional(),
  bond: z.string().nullable().optional(),
  delivery: z.string().nullable().optional(),
  incidental: z.string().nullable().optional(),
  finalVehiclePrice: z.string().nullable().optional(),
  acquisitionCost: z.string().nullable().optional(),
  exteriorColorId: z.number().int().nullable().optional(),
  exteriorColorName: z.string().nullable().optional(),
  exteriorColorHex: z.string().nullable().optional(),
  interiorColorId: z.number().int().nullable().optional(),
  interiorColorName: z.string().nullable().optional(),
  interiorColorHex: z.string().nullable().optional(),
  scenarios: z.array(quoteScenarioBody).max(3).optional(),
});

customers.post("/:id/memos", zValidator("param", idParam), zValidator("json", memoBody), async (c) => {
  const row = await addMemo(c.req.valid("param").id, c.req.valid("json"), c.var.db);
  scheduleEmbedOnWrite(c, { sourceType: "memo", sourceId: row.id });
  return c.json(row, 201);
});
customers.patch("/:id/memos/:childId", zValidator("param", childParam), zValidator("json", memoBody), (c) => {
  const p = c.req.valid("param");
  return run(c, async () => {
    const row = await updateMemo(p.id, p.childId, c.req.valid("json"), c.var.db);
    if (row) scheduleEmbedOnWrite(c, { sourceType: "memo", sourceId: p.childId });
    return row;
  }, "메모를 찾을 수 없습니다.");
});
customers.delete("/:id/memos/:childId", zValidator("param", childParam), (c) => {
  const p = c.req.valid("param");
  return run(c, async () => {
    const row = await deleteMemo(p.id, p.childId, c.var.db);
    if (row) await cleanupEmbeddingOnDelete("memo", p.childId, c.var.db); // 정리 정책 주석은 헬퍼 참조
    return row;
  }, "메모를 찾을 수 없습니다.");
});

customers.post("/:id/tasks", zValidator("param", idParam), zValidator("json", taskBody), async (c) => {
  const body = c.req.valid("json");
  if (body.category !== undefined) {
    const error = validateLookupValue("task_category", body.category);
    if (error) return c.json({ error }, 400);
  }
  const row = await addTask(c.req.valid("param").id, body, c.var.db);
  scheduleEmbedOnWrite(c, { sourceType: "task", sourceId: row.id });
  return c.json(row, 201);
});
customers.patch("/:id/tasks/:childId", zValidator("param", childParam), zValidator("json", taskBody), async (c) => {
  const p = c.req.valid("param");
  const body = c.req.valid("json");
  if (body.category !== undefined) {
    const error = validateLookupValue("task_category", body.category);
    if (error) return c.json({ error }, 400);
  }
  return run(c, async () => {
    const row = await updateTask(p.id, p.childId, body, c.var.db);
    if (row) scheduleEmbedOnWrite(c, { sourceType: "task", sourceId: p.childId });
    return row;
  }, "할 일을 찾을 수 없습니다.");
});
customers.delete("/:id/tasks/:childId", zValidator("param", childParam), (c) => {
  const p = c.req.valid("param");
  return run(c, async () => {
    const row = await deleteTask(p.id, p.childId, c.var.db);
    if (row) await cleanupEmbeddingOnDelete("task", p.childId, c.var.db);
    return row;
  }, "할 일을 찾을 수 없습니다.");
});

customers.post("/:id/schedules", zValidator("param", idParam), zValidator("json", scheduleBody), async (c) => {
  const body = c.req.valid("json");
  if (body.type !== undefined) {
    const error = validateLookupValue("schedule_type", body.type);
    if (error) return c.json({ error }, 400);
  }
  const row = await addSchedule(c.req.valid("param").id, body, c.var.db);
  scheduleEmbedOnWrite(c, { sourceType: "schedule", sourceId: row.id });
  return c.json(row, 201);
});
customers.patch("/:id/schedules/:childId", zValidator("param", childParam), zValidator("json", scheduleBody), async (c) => {
  const p = c.req.valid("param");
  const body = c.req.valid("json");
  if (body.type !== undefined) {
    const error = validateLookupValue("schedule_type", body.type);
    if (error) return c.json({ error }, 400);
  }
  return run(c, async () => {
    const row = await updateSchedule(p.id, p.childId, body, c.var.db);
    if (row) scheduleEmbedOnWrite(c, { sourceType: "schedule", sourceId: p.childId }); // done 토글 포함 — 완료 라벨 재임베딩
    return row;
  }, "일정을 찾을 수 없습니다.");
});
customers.delete("/:id/schedules/:childId", zValidator("param", childParam), (c) => {
  const p = c.req.valid("param");
  return run(c, async () => {
    const row = await deleteSchedule(p.id, p.childId, c.var.db);
    if (row) await cleanupEmbeddingOnDelete("schedule", p.childId, c.var.db);
    return row;
  }, "일정을 찾을 수 없습니다.");
});

// ── 견적 생성(composer 견적 작성 → quote + 대표 시나리오 INSERT) ──────
customers.post("/:id/quotes", zValidator("param", idParam), zValidator("json", quoteCreateBody), async (c) => {
  const id = c.req.valid("param").id;
  const body = c.req.valid("json");
  const row = await c.var.db.transaction((tx) => createQuote(id, body, tx));
  // 트랜잭션 resolve(=커밋) 후 스케줄 — 훅의 fresh read가 커밋 전 구값을 보는 것을 방지(스펙 함정).
  scheduleEmbedOnWrite(c, { sourceType: "quote", sourceId: row.id });
  return c.json(row, 201);
});

// ── 견적 쓰기(기존 견적 메타/시나리오 수정·삭제·상태 토글) ──────────
customers.patch("/:id/quotes/:childId", zValidator("param", childParam), zValidator("json", quotePatchBody), (c) => {
  const p = c.req.valid("param");
  const body = c.req.valid("json");
  return run(c, async () => {
    const row = await c.var.db.transaction((tx) => updateQuote(p.id, p.childId, body, tx));
    if (row) scheduleEmbedOnWrite(c, { sourceType: "quote", sourceId: p.childId }); // 발송(appStatus sent) 포함 — 커밋 후
    return row;
  }, "견적을 찾을 수 없습니다.");
});
customers.delete("/:id/quotes/:childId", zValidator("param", childParam), (c) => {
  const p = c.req.valid("param");
  // 트랜잭션: 견적 삭제와 advisor_quotes 회수(발송 파이프라인 스펙 결정 7)가 함께 성공/실패해야
  // 앱에 회수 실패한 유령 카드가 남지 않는다.
  return run(c, async () => {
    const row = await c.var.db.transaction((tx) => deleteQuote(p.id, p.childId, tx));
    if (row) await cleanupEmbeddingOnDelete("quote", p.childId, c.var.db);
    return row;
  }, "견적을 찾을 수 없습니다.");
});

// ── 견적 원본 파일(#4d — 견적함 행 드롭, 이미지/PDF Storage 영속) ──────
customers.post("/:id/quotes/:childId/original", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "파일이 필요합니다." }, 400);
  if (!isAllowedMime(file.type)) return c.json({ error: "허용되지 않는 파일 형식입니다." }, 415);
  if (file.size > MAX_DOC_BYTES) return c.json({ error: "파일이 너무 큽니다(최대 20MB)." }, 413);

  const env = c.env as StorageEnv;
  const objectId = crypto.randomUUID();
  const path = `${p.id}/quotes/${p.childId}-${objectId}-${safeFileName(file.name)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await uploadObject(env, path, bytes, file.type || "application/octet-stream");
  try {
    const result = await setQuoteFile(p.id, p.childId, { fileName: file.name, fileSize: file.size, fileMime: file.type || null, filePath: path }, c.var.db);
    if (!result) {
      await removeObject(env, path).catch(() => undefined); // 견적 없음 → 업로드 객체 보상 삭제
      return c.json({ error: "견적을 찾을 수 없습니다." }, 404);
    }
    if (result.previousFilePath) await removeObject(env, result.previousFilePath).catch(() => undefined); // 교체 시 이전 객체 삭제
    return c.json({ fileName: file.name, fileSize: file.size, fileMime: file.type || null }, 201);
  } catch (e) {
    await removeObject(env, path).catch(() => undefined);
    throw e;
  }
});

customers.delete("/:id/quotes/:childId/original", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const result = await clearQuoteFile(p.id, p.childId, c.var.db);
  if (!result) return c.json({ error: "견적을 찾을 수 없습니다." }, 404);
  const env = c.env as StorageEnv;
  if (result.previousFilePath) await removeObject(env, result.previousFilePath).catch((err) => console.error("Storage remove 실패(고아 객체):", err));
  return c.json({ id: p.childId });
});

customers.get("/:id/quotes/:childId/original/url", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await getQuoteFilePath(p.id, p.childId, c.var.db);
  if (!row?.filePath) return c.json({ error: "견적 원본을 찾을 수 없습니다." }, 404);
  const env = c.env as StorageEnv;
  const url = await createSignedUrl(env, row.filePath, 60); // 견적 원본은 썸네일 없음 → url=downloadUrl
  return c.json({ url, downloadUrl: url, fileMime: row.fileMime });
});

// ── 서류함 (업로드/분류/순서/삭제/미리보기 URL) ──────────────────
customers.post("/:id/documents", zValidator("param", idParam), async (c) => {
  const customerId = c.req.valid("param").id;
  const body = await c.req.parseBody();
  const file = body["file"];
  const docType = typeof body["docType"] === "string" ? body["docType"] : null;
  if (!(file instanceof File)) return c.json({ error: "파일이 필요합니다." }, 400);
  if (!isAllowedMime(file.type)) return c.json({ error: "허용되지 않는 파일 형식입니다." }, 415);
  if (file.size > MAX_DOC_BYTES) return c.json({ error: "파일이 너무 큽니다(최대 20MB)." }, 413);
  if (docType !== null) {
    const error = validateLookupValue("doc_type", docType);
    if (error) return c.json({ error }, 400);
  }

  const env = c.env as StorageEnv;
  const objectId = crypto.randomUUID();
  const path = `${customerId}/${objectId}-${safeFileName(file.name)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await uploadObject(env, path, bytes, file.type || "application/octet-stream");

  // 미리보기용 썸네일: 클라가 canvas로 구운 JPEG(있으면). 별도 객체로 저장하고 thumb_path에 기록한다.
  // 미리보기를 이 JPEG로 내보내면 가볍고 모든 브라우저(특히 Safari)가 렌더한다(render/image WebP 변환 폐기).
  const thumb = body["thumb"];
  let thumbPath: string | null = null;
  if (thumb instanceof File && thumb.type.startsWith("image/") && thumb.size > 0 && thumb.size <= MAX_DOC_BYTES) {
    thumbPath = `${customerId}/${objectId}-thumb.jpg`;
    await uploadObject(env, thumbPath, new Uint8Array(await thumb.arrayBuffer()), "image/jpeg");
  }

  try {
    const sortOrder = await nextSortOrder(customerId, c.var.db);
    const row = await addDocument(
      customerId,
      { docType, fileName: file.name, fileSize: file.size, fileMime: file.type || null, filePath: path, thumbPath, sortOrder },
      c.var.db,
    );
    // 서류함 청크는 고객당 1행(aggregate) — sourceId는 서류가 아니라 고객 id.
    scheduleEmbedOnWrite(c, { sourceType: "customer_documents", sourceId: customerId });
    return c.json({ id: row.id, docType, fileName: file.name, fileSize: file.size, fileMime: file.type || null, sortOrder, createdAt: row.createdAt }, 201);
  } catch (e) {
    await removeObject(env, path).catch(() => undefined); // 보상 삭제
    if (thumbPath) await removeObject(env, thumbPath).catch(() => undefined);
    throw e;
  }
});

customers.patch("/:id/documents/reorder", zValidator("param", idParam), zValidator("json", z.object({ order: z.array(z.object({ id: z.uuid(), sortOrder: z.number().int() })) })), async (c) => {
  await reorderDocuments(c.req.valid("param").id, c.req.valid("json").order, c.var.db);
  return c.json({ ok: true });
});

customers.patch("/:id/documents/:childId", zValidator("param", childParam), zValidator("json", z.object({ docType: z.string().nullable().optional() })), async (c) => {
  const p = c.req.valid("param");
  const body = c.req.valid("json");
  if (body.docType !== undefined) {
    const error = validateLookupValue("doc_type", body.docType);
    if (error) return c.json({ error }, 400);
  }
  return run(c, async () => {
    const row = await updateDocument(p.id, p.childId, body, c.var.db);
    if (row) scheduleEmbedOnWrite(c, { sourceType: "customer_documents", sourceId: p.id }); // 분류 변경 → 목록 재임베딩
    return row;
  }, "서류를 찾을 수 없습니다.");
});

customers.delete("/:id/documents/:childId", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await deleteDocument(p.id, p.childId, c.var.db);
  if (!row) return c.json({ error: "서류를 찾을 수 없습니다." }, 404);
  const env = c.env as StorageEnv;
  if (row.filePath) await removeObject(env, row.filePath).catch((err) => console.error("Storage remove 실패(고아 객체):", err));
  if (row.thumbPath) await removeObject(env, row.thumbPath).catch((err) => console.error("Storage thumb remove 실패(고아 객체):", err));
  // aggregate 청크라 행별 타입과 달리 동기 삭제가 아니라 재임베딩 — 남은 목록으로 갱신하고,
  // 마지막 서류 삭제(빈 텍스트)는 runEmbedJob이 임베딩 행을 지운다.
  scheduleEmbedOnWrite(c, { sourceType: "customer_documents", sourceId: p.id });
  return c.json({ id: row.id });
});

customers.get("/:id/documents/:childId/url", zValidator("param", childParam), async (c) => {
  const p = c.req.valid("param");
  const row = await getDocumentPath(p.id, p.childId, c.var.db);
  if (!row?.filePath) return c.json({ error: "서류를 찾을 수 없습니다." }, 404);
  const env = c.env as StorageEnv;
  // 미리보기: 이미지는 업로드 시 구운 JPEG 썸네일(thumb_path)로 — 가볍고 모든 브라우저(특히 Safari)가 렌더한다.
  // 썸네일 없는 옛 문서/비이미지는 원본으로 폴백. (render/image 변환은 Accept 협상으로 WebP를 내보내
  // Safari가 미리보기를 못 띄우는 회귀가 있어 폐기했다 — 2026-06-21.) 다운로드는 항상 원본.
  const isImage = (row.fileMime ?? "").startsWith("image/");
  const previewPath = isImage && row.thumbPath ? row.thumbPath : row.filePath;
  const url = await createSignedUrl(env, previewPath, 60);
  const downloadUrl = previewPath === row.filePath ? url : await createSignedUrl(env, row.filePath, 60);
  return c.json({ url, downloadUrl, fileMime: row.fileMime });
});

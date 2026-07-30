import { z } from "zod";

import { id, optionType, status } from "./shared";

// catalog 쓰기 바디 스키마 — 라우트 zValidator와 변경 요청 승인 재검증(change-request-kinds.ts)이
// 같은 정의를 본다. 여기 리터럴을 라우트에 복제하면 적재 검증과 승인 재검증이 어긋날 수 있다.
export const modelCreateBody = z.object({
  brandId: id,
  name: z.string().min(1),
  category: z.string().nullable().default(null),
  status: status.default("판매중"),
});

export const modelUpdateBody = z.object({
  category: z.string().nullable().optional(),
  status: status.optional(),
});

// 트림 본문 스키마. create는 modelId를 더해 그대로, patch는 .partial()로 전부 optional.
export const trimBody = z.object({
  trimName: z.string().min(1),
  price: z.number().int().nonnegative(),
  modelYear: z.number().int(),
  fuelType: z.string().min(1),
  driveSystem: z.string().nullable().optional(),
  displacementCc: z.number().int().nullable().optional(),
  transmissionType: z.string().nullable().optional(),
  bodyStyle: z.string().nullable().optional(),
  seatingCapacity: z.number().int().nullable().optional(),
  status: status.optional(),
  financialDiscountAmount: z.number().int().nullable().optional(),
  partnerDiscountAmount: z.number().int().nullable().optional(),
  cashDiscountAmount: z.number().int().nullable().optional(),
});
export const trimCreateBody = trimBody.extend({ modelId: id });
export const trimUpdateBody = trimBody.partial();

export const optionCreateBody = z.object({
  type: optionType,
  name: z.string().min(1),
  price: z.number().int().nullable().default(null),
});
// 변경 요청 payload용 — 라우트는 trimId를 param으로 받지만 큐에는 본문과 합쳐 저장한다.
export const optionCreatePayload = optionCreateBody.extend({ trimId: id });

export const optionUpdateBody = z.object({
  name: z.string().min(1).optional(),
  price: z.number().int().nullable().optional(),
});

// 무옵션 토글은 본문이 없다 — 큐 payload는 빈 객체로 저장·재검증한다.
export const emptyBody = z.object({});

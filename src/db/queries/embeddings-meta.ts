import { eq, inArray } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { profiles } from "../public-app";
import { customers } from "../schema";
import { composedPhone } from "./customers"; // 주 번호 합성 SSOT — 손 복제 금지(앱 연결 고객은 customers.phone이 항상 NULL)

export type CustomerMeta = { name: string; status: string; phone: string | null; phoneSecondary: string | null };

// 근거 고객들의 이름/상태(그룹·2차)/연락처 배치 조회. 빈 입력은 빈 맵.
// 연락처를 싣는 이유(2026-07-23): RAG 코퍼스는 phone을 PII로 의도 제외했고 그 결정을 유지한다
// (번호로 검색할 일이 없어 검색 가치가 실제로 0). 대신 조회 시점 메타로 병기해 근거 헤더에서 답이
// 나오게 한다 — 진행 상태가 정확히 같은 이유로 코퍼스에서 빠지고 이 메타에 실린 선례를 따른다.
// ⚠️ 주 번호는 **반드시 합성**(composedPhone + profiles 조인) — 앱 연결 고객은 `customers.phone`이
// CHECK로 항상 NULL이라 컬럼만 읽으면 화면엔 번호가 보이는데 AI만 "연락처 없음"이라 답한다
// (`#332`가 도구 경로에서 밟은 함정 그대로 — 실기 신고 케이스인 제임스·김지안이 둘 다 앱 연결이다).
export async function getCustomerMetaByIds(ids: string[], executor: Executor = getDefaultDb()): Promise<Map<string, CustomerMeta>> {
  if (ids.length === 0) return new Map();
  const rows = await executor
    .select({ id: customers.id, name: customers.name, statusGroup: customers.statusGroup, status: customers.status, phone: composedPhone, phoneSecondary: customers.phoneSecondary })
    .from(customers)
    .leftJoin(profiles, eq(customers.appUserId, profiles.id))
    .where(inArray(customers.id, ids));
  const map = new Map<string, CustomerMeta>();
  for (const r of rows) {
    const status = [r.statusGroup, r.status].filter(Boolean).join("·");
    map.set(r.id, { name: r.name, status, phone: r.phone, phoneSecondary: r.phoneSecondary });
  }
  return map;
}

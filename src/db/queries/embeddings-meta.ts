import { inArray } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { customers } from "../schema";

export type CustomerMeta = { name: string; status: string };

// 근거 고객들의 이름/상태(그룹·2차) 배치 조회. 빈 입력은 빈 맵.
export async function getCustomerMetaByIds(ids: string[], executor: Executor = getDefaultDb()): Promise<Map<string, CustomerMeta>> {
  if (ids.length === 0) return new Map();
  const rows = await executor
    .select({ id: customers.id, name: customers.name, statusGroup: customers.statusGroup, status: customers.status })
    .from(customers)
    .where(inArray(customers.id, ids));
  const map = new Map<string, CustomerMeta>();
  for (const r of rows) {
    const status = [r.statusGroup, r.status].filter(Boolean).join("·");
    map.set(r.id, { name: r.name, status });
  }
  return map;
}

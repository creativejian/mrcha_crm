// master(미스터차 앱 Supabase) REST 화이트리스트 fetch + Range 페이징.
// 키: .env.local의 MRCHA_MASTER_*. publishable 키로 차량 테이블 read 가능(검증됨).
import type { SyncTable } from "./sync-tables";

const PAGE_SIZE = 1000;

export type MasterFetchResult = { rows: Record<string, unknown>[]; total: number };

/**
 * meta.columns 화이트리스트로 master 테이블 전체를 Range 페이징하며 가져온다.
 * Content-Range의 `/total`로 전체 행수를 얻고, total까지 페이지 루프.
 */
export async function fetchMasterTable(meta: SyncTable): Promise<MasterFetchResult> {
  const base = process.env.MRCHA_MASTER_SUPABASE_URL;
  const key = process.env.MRCHA_MASTER_PUBLISHABLE_KEY;
  if (!base || !key) {
    throw new Error("MRCHA_MASTER_SUPABASE_URL / MRCHA_MASTER_PUBLISHABLE_KEY 미설정 (.env.local)");
  }

  const select = meta.columns.map((c) => c.col).join(",");
  const url = `${base}/rest/v1/${meta.name}?select=${select}`;
  const rows: Record<string, unknown>[] = [];
  let total = Number.POSITIVE_INFINITY;
  let start = 0;

  while (start < total) {
    const res = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${start}-${start + PAGE_SIZE - 1}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`master fetch ${meta.name} 실패: ${res.status} ${await res.text()}`);
    }
    const parsed = Number(res.headers.get("content-range")?.split("/")[1]);
    if (Number.isFinite(parsed)) total = parsed;
    const page = (await res.json()) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length === 0) break;
    start += page.length;
  }

  return { rows, total: Number.isFinite(total) ? total : rows.length };
}

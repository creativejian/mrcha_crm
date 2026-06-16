export type CatalogCounts = {
  brands: number;
  models: number;
  trims: number;
  trimOptions: number;
  colors: number;
  trimNoOptions: number;
  trimOptionRelations: number;
};

export type SyncTableResult = {
  name: string;
  fetched: number;
  total: number;
  complete: boolean;
  upserted: number;
  softDeleted: number;
};

export type SyncResponse = { ok: boolean; tables: SyncTableResult[] };

export async function fetchCatalogCounts(): Promise<CatalogCounts> {
  const res = await fetch("/api/catalog/counts");
  if (!res.ok) throw new Error(`catalog counts 실패: ${res.status}`);
  return (await res.json()) as CatalogCounts;
}

export async function runCatalogSync(): Promise<SyncResponse> {
  const res = await fetch("/api/catalog/sync", { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `동기화 실패: ${res.status}`);
  }
  return (await res.json()) as SyncResponse;
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const CUSTOMER_DOCS_BUCKET = "customer-documents";

// secret key는 백엔드 전용(프론트 노출 금지). CF는 c.env, 로컬/테스트는 process.env.
export type StorageEnv = { SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string } | undefined;

function resolve(env: StorageEnv): { url: string; key: string } {
  const url = env?.SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = env?.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY 가 설정되지 않았습니다.");
  return { url, key };
}

function client(env: StorageEnv): SupabaseClient {
  const { url, key } = resolve(env);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export async function uploadObject(
  env: StorageEnv,
  path: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  const { error } = await client(env)
    .storage.from(CUSTOMER_DOCS_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(`Storage 업로드 실패: ${error.message}`);
}

export async function removeObject(env: StorageEnv, path: string): Promise<void> {
  const { error } = await client(env)
    .storage.from(CUSTOMER_DOCS_BUCKET)
    .remove([path]);
  if (error) throw new Error(`Storage 삭제 실패: ${error.message}`);
}

// 다건 삭제 1왕복 — supabase-js remove는 원래 배열 API다(removeObject는 단건 포장). 고객 하드 삭제처럼
// 경로 수십 개를 지울 때 per-path 직렬 왕복(응답 지연 비례)을 피한다(0713 감사). 없는 경로는 무시된다.
export async function removeObjects(env: StorageEnv, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await client(env)
    .storage.from(CUSTOMER_DOCS_BUCKET)
    .remove(paths);
  if (error) throw new Error(`Storage 삭제 실패: ${error.message}`);
}

// transform을 주면 이미지 변환(축소·재인코딩)된 미리보기 URL을 만든다 — 큰 원본 대신 가벼운 썸네일로 빠르게.
export async function createSignedUrl(
  env: StorageEnv,
  path: string,
  expiresIn = 60,
  opts?: { transform?: { width?: number; height?: number; quality?: number } },
): Promise<string> {
  const { data, error } = await client(env)
    .storage.from(CUSTOMER_DOCS_BUCKET)
    .createSignedUrl(path, expiresIn, opts);
  if (error || !data) throw new Error(`Storage signed URL 실패: ${error?.message ?? "데이터 없음"}`);
  return data.signedUrl;
}

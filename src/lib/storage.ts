import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const CUSTOMER_DOCS_BUCKET = "customer-documents";

// secret key는 백엔드 전용(프론트 노출 금지). CF는 c.env, 로컬/테스트는 process.env.
type StorageEnv = { SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string } | undefined;

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

export async function createSignedUrl(env: StorageEnv, path: string, expiresIn = 60): Promise<string> {
  const { data, error } = await client(env)
    .storage.from(CUSTOMER_DOCS_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error || !data) throw new Error(`Storage signed URL 실패: ${error?.message ?? "데이터 없음"}`);
  return data.signedUrl;
}

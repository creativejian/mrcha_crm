import { createRemoteJWKSet } from "jose";

import { verifyStaff } from "../crm-analyst/auth.ts";
import { relayRequest } from "./relay.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

// JWKS는 모듈 레벨 1회 생성(crm-analyst 동일).
const issuer = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : "";
const jwks = SUPABASE_URL ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) : null;

// CORS 없음 — CRM 백엔드(서버→서버) 전용, 브라우저 호출 없음.
Deno.serve(async (req) => {
  if (!jwks) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const header = req.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return Response.json({ error: "인증이 필요합니다." }, { status: 401 });
  const gate = await verifyStaff(token, jwks, { issuer, audience: "authenticated" });
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });
  return relayRequest(req);
});

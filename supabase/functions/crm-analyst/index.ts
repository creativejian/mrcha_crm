import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRemoteJWKSet } from "jose";

import { verifyStaff } from "./auth.ts";
import { buildClassifyPrompt, CLASSIFY_RESPONSE_SCHEMA } from "./doc-types.ts";
import { classifyDocumentImage } from "./gemini.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

const ALLOWED_ORIGINS = [
  "https://crm.mrcha.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const app = new Hono();

app.use("*", cors({
  origin: ALLOWED_ORIGINS,
  allowMethods: ["POST", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type"],
}));

// JWKS는 issuer당 1회 생성(모듈 레벨 캐시).
const issuer = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : "";
const jwks = SUPABASE_URL ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) : null;

// staff 인증 게이트 — 전 경로(*)에 적용한다. "/crm-analyst/*" glob은 trailing slash 없는
// 함수 루트 요청("/crm-analyst")을 놓쳐 인증 우회가 생길 수 있어 * 로 전체 적용한다.
// OPTIONS(preflight)는 위 cors 미들웨어가 선처리(next 호출 없이 응답)하므로 여기 안 걸린다.
app.use("*", async (c, next) => {
  if (!jwks) return c.json({ error: "서버 설정 오류입니다." }, 500);
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return c.json({ error: "인증이 필요합니다." }, 401);
  const gate = await verifyStaff(token, jwks, { issuer, audience: "authenticated" });
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  await next();
});

// 첫 슬라이스는 분류 단일 동작 — supabase functions.invoke("crm-analyst")가 넘기는 경로에
// 관대하도록 POST * 로 받는다(앱 ai-analyst의 app.all("*") 패턴과 동일 이유). 슬라이스 B는
// body.action 또는 서브패스로 분기.
app.post("*", async (c) => {
  if (!GEMINI_API_KEY) return c.json({ error: "서버 설정 오류입니다." }, 500);
  const bodyJson = (await c.req.json().catch(() => null)) as
    | { mimeType?: string; dataBase64?: string }
    | null;
  if (!bodyJson?.mimeType || !bodyJson?.dataBase64) {
    return c.json({ error: "mimeType·dataBase64가 필요합니다." }, 400);
  }
  try {
    const docType = await classifyDocumentImage({
      apiKey: GEMINI_API_KEY,
      mimeType: bodyJson.mimeType,
      dataBase64: bodyJson.dataBase64,
      prompt: buildClassifyPrompt(),
      responseSchema: CLASSIFY_RESPONSE_SCHEMA,
    });
    return c.json({ docType });
  } catch (e) {
    // Gemini 실패(재시도 후에도) → 502. 프론트 lib이 error로 받아 파일명 regex 폴백한다.
    console.error("[crm-analyst] 분류 실패", e);
    return c.json({ error: "분류에 실패했습니다." }, 502);
  }
});

Deno.serve(app.fetch);

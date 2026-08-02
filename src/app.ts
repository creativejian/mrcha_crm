import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";

import { createAuthMiddleware } from "./middleware/auth";
import { dbMiddleware } from "./middleware/db";
import { dealerWriteGate } from "./middleware/role-gate";
import { accountDeletions } from "./routes/account-deletions";
import { appAccountDeletion } from "./routes/app-account-deletion";
import { assistant } from "./routes/assistant";
import { catalog } from "./routes/catalog";
import { consultations } from "./routes/consultations";
import { insightsRoute, knowledgeRoute } from "./routes/content";
import { customers } from "./routes/customers";
import { dealer } from "./routes/dealer";
import { me } from "./routes/me";
import { quoteRequests } from "./routes/quote-requests";
import { reports } from "./routes/reports";
import { solution } from "./routes/solution";
import { staff } from "./routes/staff";
import { vehicles } from "./routes/vehicles";

// 테스트는 authOpts(로컬 keyResolver+issuer)를 주입해 보호 라우트를 통과 검증한다.
export function createApp(authOpts?: { keyResolver: JWTVerifyGetKey; issuer: string }) {
  const app = new Hono();
  const auth = createAuthMiddleware(authOpts);

  // hyperdrive: 요청 env에 HYPERDRIVE binding이 실제로 주입됐는지 진단(비밀 노출 없음).
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      service: "mrcha-crm",
      hyperdrive: !!(c.env as { HYPERDRIVE?: unknown } | undefined)?.HYPERDRIVE,
    }),
  );

  // 보호 라우트 공통 체인 — 순서가 규약: auth(401) → dealerWriteGate(403, dealer 쓰기 전면 차단)
  // → db. 401/403은 db 생성 없이 차단된다. 딜러의 정당한 쓰기 개방은 role-gate.ts allowlist로.
  const protect = (path: string) => {
    app.use(path, auth);
    app.use(path, dealerWriteGate);
    app.use(path, dbMiddleware);
  };
  protect("/api/vehicles/*");
  protect("/api/catalog/*");
  protect("/api/customers/*");
  protect("/api/quote-requests/*");
  protect("/api/consultations/*");
  protect("/api/insights/*");
  protect("/api/knowledge/*");
  protect("/api/assistant/*");
  protect("/api/solution/*");
  protect("/api/reports/*");
  protect("/api/staff/*");
  protect("/api/me/*");
  protect("/api/dealer/*");
  protect("/api/account-deletions/*"); // 탈퇴 인지 큐(스태프 — JWT)

  // 앱 탈퇴 오케스트레이터 전용 — JWT가 아니라 공유 시크릿(라우트 내부 미들웨어가 검증).
  // auth/dealerWriteGate를 태우지 않고 db만 배선한다(호출자 = 앱 Edge Function, 사용자 세션 없음).
  app.use("/api/app/account-deletion/*", dbMiddleware);

  app.route("/api/vehicles", vehicles);
  app.route("/api/catalog", catalog);
  app.route("/api/customers", customers);
  app.route("/api/quote-requests", quoteRequests);
  app.route("/api/consultations", consultations);
  app.route("/api/insights", insightsRoute);
  app.route("/api/knowledge", knowledgeRoute);
  app.route("/api/assistant", assistant);
  app.route("/api/solution", solution);
  app.route("/api/reports", reports);
  app.route("/api/staff", staff);
  app.route("/api/me", me);
  app.route("/api/dealer", dealer);
  app.route("/api/account-deletions", accountDeletions);
  app.route("/api/app/account-deletion", appAccountDeletion);

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  // 처리되지 않은 에러는 CF 실시간 로그로 진단할 수 있게 console.error로 남기되,
  // 응답 본문에는 내부 정보(DB 에러 등)를 노출하지 않는다.
  app.onError((err, c) => {
    console.error(err);
    // drizzle은 원인을 err.cause로 감싼다(postgres.js 연결/쿼리 에러). 진단용으로 함께 남긴다.
    const cause = (err as { cause?: unknown }).cause;
    if (cause)
      console.error(
        "DB cause:",
        cause instanceof Error ? `${cause.name}: ${cause.message}` : JSON.stringify(cause),
      );
    return c.json({ error: "Internal Server Error" }, 500);
  });
  return app;
}

export const app = createApp();

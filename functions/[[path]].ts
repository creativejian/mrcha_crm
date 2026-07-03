import { app } from "../src/app";

// 루트 catch-all이므로 정적 자산 요청까지 모두 매치된다. /api/* 만 Hono로 보내고
// 나머지는 next()로 정적 자산(SPA)에 위임한다. (이게 없으면 / 가 app.notFound 404)
//
// context는 반드시 세 번째 인자(ExecutionContext)로 전달한다 — 누락 시 c.executionCtx 접근이
// throw하고 waitUntil 기반 로직(dbMiddleware 연결 종료, 스트리밍 abort 가드)이 전부 폴백으로
// 강등된다. 특히 dbMiddleware 폴백이 dbHold(스트림 수명)를 인라인 대기하면 SSE 응답이 스트림
// 종료까지 반환되지 못하는 데드락이 된다(2026-07-03 prod 524 사고 — 업무 AI 스트리밍 전면 불능).
export const onRequest = (context: {
  request: Request;
  env: unknown;
  next: () => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
  passThroughOnException: () => void;
}) => {
  const { pathname } = new URL(context.request.url);
  // hono의 ExecutionContext 타입은 props를 요구하지만 Pages EventContext엔 없다(런타임은 waitUntil만 사용) — 캐스트.
  if (pathname.startsWith("/api"))
    return app.fetch(context.request, context.env, context as unknown as Parameters<typeof app.fetch>[2]);
  return context.next();
};

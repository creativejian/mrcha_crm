import { app } from "../src/app";

// 루트 catch-all이므로 정적 자산 요청까지 모두 매치된다. /api/* 만 Hono로 보내고
// 나머지는 next()로 정적 자산(SPA)에 위임한다. (이게 없으면 / 가 app.notFound 404)
export const onRequest = (context: { request: Request; env: unknown; next: () => Promise<Response> }) => {
  const { pathname } = new URL(context.request.url);
  if (pathname.startsWith("/api")) return app.fetch(context.request, context.env);
  return context.next();
};

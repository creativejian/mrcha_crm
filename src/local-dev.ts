import { app } from "./app";

// 빈 문자열("")/0/NaN 모두 기본 8788로 떨어지게 한다.
// (PORT="" 이면 Number("")=0 → Bun이 랜덤 포트를 잡아 vite proxy(8788)와 어긋난다)
const port = Number(process.env.PORT) || 8788;

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`Mr. Cha CRM API running at http://127.0.0.1:${server.port}`);

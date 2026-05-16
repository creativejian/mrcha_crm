import { app } from "./app";

const port = Number(process.env.PORT ?? 8788);

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`Mr. Cha CRM API running at http://127.0.0.1:${server.port}`);
